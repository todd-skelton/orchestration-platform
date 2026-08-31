/* ISS-022 experiment only: no selection, certification, or production API.
 * The stable builder owns the exact toolchain, headers, flags and load path.
 */
#ifndef _WIN32
#define _GNU_SOURCE
#else
#define _WIN32_WINNT 0x0602
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NAPI_VERSION
#define NAPI_VERSION 8
#endif
#if NAPI_VERSION != 8
#error This experiment requires NAPI_VERSION=8
#endif
#include <node_api.h>
#include <stdbool.h>
#include <stdint.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <windows.h>
typedef HANDLE native_handle;
#define NO_HANDLE INVALID_HANDLE_VALUE
#define THREAD_LOCAL __declspec(thread)
#else
#include <errno.h>
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>
typedef int native_handle;
#define NO_HANDLE (-1)
#define THREAD_LOCAL _Thread_local
/* Darwin dev_t is signed 32-bit: widen its unsigned bits, not its sign.
 * Linux device and both platforms' inode values retain their native width.
 * These file-local expressions also drive the host-build numerical checks.
 */
#ifdef __APPLE__
#define POSIX_DEVICE_BITS(value) ((uintmax_t)(uint32_t)(value))
_Static_assert(sizeof(dev_t) == sizeof(uint32_t), "Darwin device width changed");
_Static_assert(POSIX_DEVICE_BITS((dev_t)(-INT32_C(2147483647) - 1)) == UINTMAX_C(2147483648),
               "Darwin high device bit must not sign-extend");
_Static_assert(POSIX_DEVICE_BITS((dev_t)-1) == UINTMAX_C(4294967295),
               "Darwin device identity retains all 32 unsigned bits");
#else
#define POSIX_DEVICE_BITS(value) ((uintmax_t)(value))
_Static_assert(POSIX_DEVICE_BITS((dev_t)UINT64_C(9007199254740993)) == UINTMAX_C(9007199254740993),
               "Linux device identity must retain bits beyond JavaScript Number precision");
_Static_assert(POSIX_DEVICE_BITS((dev_t)UINT64_C(0x8000000000000001)) == UINT64_C(0x8000000000000001),
               "Linux device identity must retain the full 64-bit width");
#endif
#define POSIX_INODE_BITS(value) ((uintmax_t)(value))
_Static_assert(POSIX_INODE_BITS((ino_t)UINT64_C(9007199254740993)) == UINTMAX_C(9007199254740993),
               "Inode identity must retain bits beyond JavaScript Number precision");
_Static_assert(POSIX_INODE_BITS((ino_t)UINT64_C(0x8000000000000001)) == UINT64_C(0x8000000000000001),
               "Inode identity must retain the full 64-bit width");
#endif

enum state { UNOPENED, OPEN, LOCKED, CLOSED };
typedef struct context {
  napi_env env;
  napi_ref brand;
  enum state state;
  bool busy, resource_open, identity_known;
  int non_inheritable; /* -1: no read-back available. */
  native_handle native;
  char device[32], file[33];
  struct context *next;
} context;
typedef struct {
  const char *operation;
  char value[32], error[32], native[32], device[32], file[33];
  bool open, identity_known;
  int non_inheritable;
} fact;
typedef struct { fact calls[8]; size_t count; } facts;

/* Reinitialization after require-cache deletion cannot open again.
 * Callbacks/cleanup use their environment's thread. This list separates worker
 * environments without OS synchronization or replacing another addon's
 * environment instance data. Cleanup is not observed release evidence.
 */
static THREAD_LOCAL context *contexts;
static const napi_type_tag brand_tag = {
  UINT64_C(0x8ebc3ab42dfe4095), UINT64_C(0xa11ba67d32103964)
};

static bool api(napi_env env, napi_status status) {
  if (status == napi_ok) return true;
  bool pending = false;
  napi_is_exception_pending(env, &pending);
  if (!pending) napi_throw_error(env, NULL, "Native experiment Node-API failure");
  return false;
}
#define API(expr) do { if (!api(env, (expr))) goto failure; } while (0)
static void unsigned_text(char *out, uintmax_t value) {
  snprintf(out, 32, "%" PRIuMAX, value);
}
static void record(context *ctx, facts *out, const char *operation,
                   intmax_t value, uintmax_t error) {
  fact *f = &out->calls[out->count++];
  memset(f, 0, sizeof(*f));
  f->operation = operation;
  snprintf(f->value, sizeof(f->value), "%" PRIdMAX, value);
  unsigned_text(f->error, error);
  f->open = ctx->resource_open;
  if (f->open) unsigned_text(f->native, (uintptr_t)ctx->native);
  f->identity_known = ctx->identity_known;
  memcpy(f->device, ctx->device, sizeof(f->device));
  memcpy(f->file, ctx->file, sizeof(f->file));
  f->non_inheritable = f->open ? ctx->non_inheritable : -1;
}

/* Invalidate before closing once. Never retry an ambiguous close: the native
 * descriptor might already be reused, including by environment cleanup.
 */
static void close_once(context *ctx, facts *out) {
  native_handle native = ctx->native;
  ctx->resource_open = false;
  ctx->native = NO_HANDLE;
  ctx->state = CLOSED;
#ifdef _WIN32
  BOOL value = CloseHandle(native);
  DWORD error = value ? 0 : GetLastError();
#else
  int value = close(native);
  int error = value == 0 ? 0 : errno;
#endif
  if (out) record(ctx, out, "CLOSE", value, error);
}
static void cleanup(void *data) {
  context *ctx = data;
  if (ctx->resource_open) close_once(ctx, NULL);
  context **link = &contexts;
  while (*link && *link != ctx) link = &(*link)->next;
  if (*link) *link = ctx->next;
  free(ctx);
}

/* Preserve real native results even on metadata invariant refusal. Stop before
 * FLAGS, so a consumer requiring the complete fixed sequence detects refusal.
 * Never fabricate errno, metadata fields, or a candidate verdict.
 */
static bool inspect(context *ctx, facts *out, bool opening) {
  ctx->identity_known = false;
  ctx->non_inheritable = -1;
#ifdef _WIN32
  FILE_ID_INFO id;
  BOOL value = GetFileInformationByHandleEx(ctx->native, FileIdInfo, &id, sizeof(id));
  DWORD error = value ? 0 : GetLastError();
  if (value) {
    unsigned_text(ctx->device, id.VolumeSerialNumber);
    for (size_t i = 0; i < 16; ++i)
      snprintf(ctx->file + i * 2, 3, "%02x", (unsigned)id.FileId.Identifier[i]);
    ctx->identity_known = true;
  }
  record(ctx, out, "IDENTIFY", value, error);
  if (!value) return false;
  FILE_STANDARD_INFO standard;
  value = GetFileInformationByHandleEx(ctx->native, FileStandardInfo, &standard, sizeof(standard));
  error = value ? 0 : GetLastError();
  record(ctx, out, "IDENTIFY", value, error);
  if (!value || standard.Directory || standard.DeletePending ||
      standard.NumberOfLinks != 1 || standard.EndOfFile.QuadPart != 1) return false;
  FILE_ATTRIBUTE_TAG_INFO attributes;
  value = GetFileInformationByHandleEx(ctx->native, FileAttributeTagInfo, &attributes, sizeof(attributes));
  error = value ? 0 : GetLastError();
  record(ctx, out, "IDENTIFY", value, error);
  if (!value || (attributes.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) return false;
  if (opening) {
    value = SetHandleInformation(ctx->native, HANDLE_FLAG_INHERIT, 0);
    error = value ? 0 : GetLastError();
    record(ctx, out, "FLAGS", value, error);
    if (!value) return false;
  }
  DWORD flags = 0;
  value = GetHandleInformation(ctx->native, &flags);
  error = value ? 0 : GetLastError();
  if (value) ctx->non_inheritable = (flags & HANDLE_FLAG_INHERIT) == 0;
  record(ctx, out, "FLAGS", value, error);
  return value && ctx->non_inheritable == 1;
#else
  (void)opening;
  struct stat status;
  int value = fstat(ctx->native, &status);
  int error = value == 0 ? 0 : errno;
  if (value == 0) {
    unsigned_text(ctx->device, POSIX_DEVICE_BITS(status.st_dev));
    unsigned_text(ctx->file, POSIX_INODE_BITS(status.st_ino));
    ctx->identity_known = true;
  }
  record(ctx, out, "IDENTIFY", value, error);
  if (value != 0 || !S_ISREG(status.st_mode) || status.st_nlink != 1 || status.st_size != 1)
    return false;
  value = fcntl(ctx->native, F_GETFD);
  error = value >= 0 ? 0 : errno;
  if (value >= 0) ctx->non_inheritable = (value & FD_CLOEXEC) != 0;
  record(ctx, out, "FLAGS", value, error);
  return value >= 0 && ctx->non_inheritable == 1;
#endif
}

static napi_value string_value(napi_env env, const char *text) {
  napi_value result;
  if (!api(env, napi_create_string_utf8(env, text, NAPI_AUTO_LENGTH, &result))) return NULL;
  return result;
}
static bool member(napi_env env, napi_value object, const char *name, napi_value value) {
  if (!value) return false;
  napi_property_descriptor property = {name, NULL, NULL, NULL, NULL, value, napi_enumerable, NULL};
  return api(env, napi_define_properties(env, object, 1, &property));
}
static napi_value facts_value(napi_env env, const facts *out) {
  napi_value array, null_value;
  API(napi_create_array_with_length(env, out->count, &array));
  API(napi_get_null(env, &null_value));
  for (size_t i = 0; i < out->count; ++i) {
    const fact *f = &out->calls[i];
    napi_value object, identity = null_value, flag = null_value;
    API(napi_create_object(env, &object));
    if (f->identity_known) {
      API(napi_create_object(env, &identity));
#ifdef _WIN32
      if (!member(env, identity, "kind", string_value(env, "WINDOWS")) ||
          !member(env, identity, "volumeSerialNumber", string_value(env, f->device)) ||
          !member(env, identity, "fileIdHex", string_value(env, f->file))) goto failure;
#else
      if (!member(env, identity, "kind", string_value(env, "POSIX")) ||
          !member(env, identity, "device", string_value(env, f->device)) ||
          !member(env, identity, "inode", string_value(env, f->file))) goto failure;
#endif
    }
    if (f->non_inheritable >= 0) API(napi_get_boolean(env, f->non_inheritable == 1, &flag));
    if (!member(env, object, "operation", string_value(env, f->operation)) ||
        !member(env, object, "returnValue", string_value(env, f->value)) ||
        !member(env, object, "errorCode", string_value(env, f->error)) ||
        !member(env, object, "identity", identity) ||
        !member(env, object, "nativeHandle", f->open ? string_value(env, f->native) : null_value) ||
        !member(env, object, "nonInheritable", flag)) goto failure;
    char index[32];
    unsigned_text(index, i);
    /* Own definitions cannot invoke hostile prototype setters/reentrancy. */
    if (!member(env, array, index, object)) goto failure;
  }
  return array;
failure:
  return NULL;
}

static context *begin(napi_env env, napi_callback_info info, napi_value *argument, bool opening) {
  size_t count = 2;
  napi_value arguments[2];
  void *data = NULL;
  if (!api(env, napi_get_cb_info(env, info, &count, arguments, NULL, &data))) return NULL;
  context *ctx = data;
  if (!ctx || ctx->env != env || ctx->busy || count != 1) goto invalid;
  napi_valuetype type;
  if (!api(env, napi_typeof(env, arguments[0], &type))) return NULL;
  if (opening) {
    if (ctx->state != UNOPENED || type != napi_string) goto invalid;
  } else {
    if ((ctx->state != OPEN && ctx->state != LOCKED) || type != napi_object) goto invalid;
    bool tagged = false, equal = false;
    napi_value branded;
    if (!api(env, napi_check_object_type_tag(env, arguments[0], &brand_tag, &tagged))) return NULL;
    if (!tagged) goto invalid;
    if (!api(env, napi_get_reference_value(env, ctx->brand, &branded)) ||
        !api(env, napi_strict_equals(env, branded, arguments[0], &equal))) return NULL;
    if (!equal) goto invalid;
  }
  *argument = arguments[0];
  ctx->busy = true;
  return ctx;
invalid:
  napi_throw_type_error(env, NULL, "Invalid native experiment argument, handle, or state");
  return NULL;
}

static napi_value open_fixed(napi_env env, napi_callback_info info) {
  napi_value argument, handle, result, array;
  context *ctx = begin(env, info, &argument, true);
  if (!ctx) return NULL;
  char16_t *path = NULL;
  size_t length = 0, copied = 0;
  API(napi_get_value_string_utf16(env, argument, NULL, 0, &length));
  if (length == 0 || length > (SIZE_MAX / sizeof(char16_t)) - 1) goto invalid_path;
  path = calloc(length + 1, sizeof(char16_t));
  if (!path) { napi_throw_error(env, NULL, "Path allocation failed"); goto failure; }
  API(napi_get_value_string_utf16(env, argument, path, length + 1, &copied));
  if (copied != length) goto invalid_path;
  for (size_t i = 0; i < length; ++i) {
    if (!path[i]) goto invalid_path;
    /* Refuse lossy Unicode conversion rather than opening another path. */
    if (path[i] >= 0xd800 && path[i] <= 0xdbff) {
      if (++i == length || path[i] < 0xdc00 || path[i] > 0xdfff) goto invalid_path;
    } else if (path[i] >= 0xdc00 && path[i] <= 0xdfff) goto invalid_path;
  }
#ifdef _WIN32
  bool drive = length >= 3 && ((path[0] >= 'A' && path[0] <= 'Z') ||
                (path[0] >= 'a' && path[0] <= 'z')) && path[1] == ':' &&
                (path[2] == '\\' || path[2] == '/');
  bool unc = length >= 5 && path[0] == '\\' && path[1] == '\\';
  if (!drive && !unc) goto invalid_path;
#else
  if (path[0] != '/') goto invalid_path;
#endif
  API(napi_create_object(env, &handle));
  API(napi_type_tag_object(env, handle, &brand_tag));
  API(napi_create_reference(env, handle, 1, &ctx->brand));
  facts out = {0};
  /* A valid native attempt consumes the path lifetime even when it fails. */
  ctx->state = CLOSED;
#ifdef _WIN32
  ctx->native = CreateFileW((LPCWSTR)path, GENERIC_READ | GENERIC_WRITE,
    FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING,
    FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  DWORD error = ctx->native == NO_HANDLE ? GetLastError() : 0;
  ctx->resource_open = ctx->native != NO_HANDLE;
  record(ctx, &out, "OPEN", 0, error);
  /* HANDLE, including INVALID_HANDLE_VALUE, is an unsigned pointer value. */
  unsigned_text(out.calls[0].value, (uintptr_t)ctx->native);
#else
  size_t bytes = 0;
  API(napi_get_value_string_utf8(env, argument, NULL, 0, &bytes));
  char *utf8 = malloc(bytes + 1);
  if (!utf8) { napi_throw_error(env, NULL, "Path allocation failed"); goto failure; }
  napi_status conversion = napi_get_value_string_utf8(env, argument, utf8, bytes + 1, &copied);
  if (!api(env, conversion)) { free(utf8); goto failure; }
  ctx->native = open(utf8, O_RDWR | O_CLOEXEC | O_NOFOLLOW);
  int error = ctx->native >= 0 ? 0 : errno;
  ctx->resource_open = ctx->native >= 0;
  record(ctx, &out, "OPEN", ctx->native, error);
  free(utf8);
#endif
  free(path);
  path = NULL;
  if (ctx->resource_open) {
    if (inspect(ctx, &out, true)) ctx->state = OPEN;
    else close_once(ctx, &out);
  }
  if (ctx->state != OPEN) API(napi_get_null(env, &handle));
  array = facts_value(env, &out);
  if (!array) goto failure;
  API(napi_create_object(env, &result));
  if (!member(env, result, "handle", handle) || !member(env, result, "facts", array)) goto failure;
  ctx->busy = false;
  return result;
invalid_path:
  napi_throw_type_error(env, NULL, "Expected an absolute path without NUL or malformed Unicode");
failure:
  free(path);
  if (ctx->resource_open) close_once(ctx, NULL);
  ctx->busy = false;
  return NULL;
}

enum action { TRY, RELEASE, CLOSE, DESCRIBE };
static napi_value operate(napi_env env, napi_callback_info info, enum action action) {
  napi_value argument;
  context *ctx = begin(env, info, &argument, false);
  if (!ctx) return NULL;
  if ((action == RELEASE && ctx->state != LOCKED) ||
      ((action == TRY || action == CLOSE) && ctx->state != OPEN)) {
    ctx->busy = false;
    napi_throw_type_error(env, NULL, "Native experiment operation is invalid in this state");
    return NULL;
  }
  facts out = {0};
  if (action == CLOSE) close_once(ctx, &out);
  else if (action == DESCRIBE) {
    /* Observe current inheritance; never repair it during describe. */
    inspect(ctx, &out, false);
  } else {
#ifdef _WIN32
    OVERLAPPED ov = {0};
    BOOL value = action == TRY
      ? LockFileEx(ctx->native, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &ov)
      : UnlockFileEx(ctx->native, 0, 1, 0, &ov);
    DWORD error = value ? 0 : GetLastError();
    bool success = value != 0;
#else
    int value = flock(ctx->native, action == TRY ? LOCK_EX | LOCK_NB : LOCK_UN);
    int error = value == 0 ? 0 : errno;
    bool success = value == 0;
#endif
    record(ctx, &out, action == TRY ? "TRY_LOCK" : "UNLOCK", value, error);
    if (success) ctx->state = action == TRY ? LOCKED : OPEN;
    /* No EINTR/error retry. The stable parent counts attempts per command. */
  }
  napi_value result = facts_value(env, &out);
  if (!result && ctx->resource_open) close_once(ctx, NULL);
  ctx->busy = false;
  return result;
}
static napi_value try_lock(napi_env env, napi_callback_info info) { return operate(env, info, TRY); }
static napi_value release(napi_env env, napi_callback_info info) { return operate(env, info, RELEASE); }
static napi_value close_handle(napi_env env, napi_callback_info info) { return operate(env, info, CLOSE); }
static napi_value describe(napi_env env, napi_callback_info info) { return operate(env, info, DESCRIBE); }

NAPI_MODULE_INIT() {
  context *ctx = contexts;
  while (ctx && ctx->env != env) ctx = ctx->next;
  if (!ctx) {
    ctx = calloc(1, sizeof(*ctx));
    if (!ctx) { napi_throw_error(env, NULL, "Environment allocation failed"); return NULL; }
    ctx->env = env;
    ctx->native = NO_HANDLE;
    ctx->non_inheritable = -1;
    if (!api(env, napi_add_env_cleanup_hook(env, cleanup, ctx))) { free(ctx); return NULL; }
    ctx->next = contexts;
    contexts = ctx;
  }
  napi_value version = string_value(env, "iss022-native-lock-experiment/v1");
  if (!version) return NULL;
  napi_property_descriptor properties[] = {
    {"interfaceVersion", NULL, NULL, NULL, NULL, version, napi_enumerable, NULL},
    {"openFixedLock", NULL, open_fixed, NULL, NULL, NULL, napi_enumerable, ctx},
    {"tryLock", NULL, try_lock, NULL, NULL, NULL, napi_enumerable, ctx},
    {"release", NULL, release, NULL, NULL, NULL, napi_enumerable, ctx},
    {"close", NULL, close_handle, NULL, NULL, NULL, napi_enumerable, ctx},
    {"describe", NULL, describe, NULL, NULL, NULL, napi_enumerable, ctx}
  };
  if (!api(env, napi_define_properties(env, exports, 6, properties))) return NULL;
  return exports;
}
