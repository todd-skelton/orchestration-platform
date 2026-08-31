/* Stable-only ISS-022 witness. Independently authored; no candidate source reuse.
 * Diagnostic facts are claims for the stable driver to check, never verdicts.
 * Build only with the separately reviewed stable builder and NAPI_VERSION=8.
 */
#ifndef _WIN32
#define _POSIX_C_SOURCE 200809L
#define _DARWIN_C_SOURCE 1
#endif
#include <node_api.h>
#if NAPI_VERSION != 8
#error This experiment requires NAPI_VERSION=8
#endif
#include <stdbool.h>
#include <stdint.h>
#include <inttypes.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0602
#endif
#include <windows.h>
typedef HANDLE native_handle;
typedef wchar_t path_char;
#else
#include <errno.h>
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>
typedef int native_handle;
typedef char path_char;
#endif

#define INTERFACE "iss022-native-lock-experiment/v1"
#define FACT_LIMIT 8
#define DECIMAL_SIZE (sizeof(uintmax_t) * 3 + 3)
/* Preserve the unsigned bit pattern at the native field's width. In particular,
 * widening Darwin's signed 32-bit dev_t directly would sign-extend its high bit.
 * The value is evaluated once; sizeof retains its type before integer promotion.
 */
#define NATIVE_UNSIGNED(value) \
  ((uintmax_t)(value) & \
   (UINTMAX_MAX >> ((sizeof(uintmax_t) - sizeof(value)) * CHAR_BIT)))
#ifndef _WIN32
_Static_assert(sizeof(((struct stat *)0)->st_dev) <= sizeof(uintmax_t),
               "Native device identity must fit uintmax_t");
_Static_assert(sizeof(((struct stat *)0)->st_ino) <= sizeof(uintmax_t),
               "Native inode identity must fit uintmax_t");
#endif
/* Regression assertions exercise the actual conversion used by observe().
 * They become evidence only when the reviewed source is compiled by the host.
 */
_Static_assert(NATIVE_UNSIGNED((int32_t)INT32_MIN) == UINTMAX_C(2147483648),
               "A signed 32-bit device high bit must not sign-extend");
_Static_assert(NATIVE_UNSIGNED((int32_t)-1) == UINTMAX_C(4294967295),
               "A signed 32-bit all-ones device must retain exactly 32 bits");
_Static_assert(NATIVE_UNSIGNED((uint64_t)UINT64_C(9007199254740993)) ==
               UINTMAX_C(9007199254740993),
               "A full-width identity above 2^53 must remain exact");
_Static_assert(NATIVE_UNSIGNED((uint64_t)UINT64_MAX) == UINT64_MAX,
               "A full-width unsigned identity must not narrow to 32 bits");
typedef enum { UNOPENED, OPEN, LOCKED, CLOSED } phase;
typedef enum { FIXED_FILE, INSPECTION, PARENT_DIRECTORY } purpose;
typedef struct {
  native_handle handle;
  bool live;
  bool identified;
  char first[DECIMAL_SIZE];
  char second[DECIMAL_SIZE + 33];
  int non_inheritable; /* -1 means no read-back available. */
} view;
typedef struct {
  const char *operation;
  char result[DECIMAL_SIZE];
  char error[DECIMAL_SIZE];
  view snapshot;
} fact;
typedef struct { fact items[FACT_LIMIT]; size_t length; } transcript;
typedef struct {
  phase state;
  bool busy;
  bool bound;
  path_char *parent;
  view file;
  napi_ref brand;
} witness;
/* Node callbacks and cleanup run on their environment thread. This storage
 * creates no thread or OS operation. Refuse a second native initialization on
 * that thread until cleanup, including a JS require.cache eviction/reload.
 * Never share napi_env values or overwrite another addon's instance-data slot.
 * Multiple simultaneous embedded environments on one thread are not admitted. */
#ifdef _WIN32
static __declspec(thread) witness *environment_witness;
#else
static _Thread_local witness *environment_witness;
#endif
static const napi_type_tag handle_tag = {
  UINT64_C(0x65f70a1dc8344b9e), UINT64_C(0xa3df027eb6c85192)
};

static napi_value type_error(napi_env env) {
  napi_throw_type_error(env, NULL, "Invalid stable witness argument or state");
  return NULL;
}
static napi_value api_error(napi_env env) {
  bool pending = false;
  napi_is_exception_pending(env, &pending);
  if (!pending) napi_throw_error(env, NULL, "Stable witness Node-API failure");
  return NULL;
}
#define API(call) do { if ((call) != napi_ok) return api_error(env); } while (0)
static void unsigned_decimal(char *out, uintmax_t value) {
  snprintf(out, DECIMAL_SIZE, "%" PRIuMAX, value);
}
static view empty_view(native_handle handle, bool live) {
  view result;
  memset(&result, 0, sizeof(result));
  result.handle = handle;
  result.live = live;
  result.non_inheritable = -1;
  return result;
}
static fact *append(transcript *out, const char *operation, uintmax_t error,
                    const view *current) {
  /* The closed call sequences below have at most seven entries. */
  fact *entry = &out->items[out->length++];
  entry->operation = operation;
  unsigned_decimal(entry->error, error);
  entry->snapshot = *current;
  return entry;
}
static void signed_fact(transcript *out, const char *op, intmax_t result,
                        uintmax_t error, const view *current) {
  fact *entry = append(out, op, error, current);
  snprintf(entry->result, DECIMAL_SIZE, "%" PRIdMAX, result);
}
#ifdef _WIN32
static void handle_fact(transcript *out, HANDLE result, DWORD error,
                        const view *current) {
  fact *entry = append(out, "OPEN", error, current);
  unsigned_decimal(entry->result, (uintmax_t)(uintptr_t)result);
}
#endif
static bool close_once(view *current, transcript *out) {
  native_handle handle = current->handle;
  current->live = false; /* No retry and no later use, even after ambiguous failure. */
#ifdef _WIN32
  BOOL result = CloseHandle(handle);
  DWORD error = result ? 0 : GetLastError();
  if (out) signed_fact(out, "CLOSE", result, error, current);
  return result != 0;
#else
  int result = close(handle);
  int error = result == 0 ? 0 : errno;
  if (out) signed_fact(out, "CLOSE", result, (uintmax_t)error, current);
  return result == 0;
#endif
}

/* INSPECTION accepts an existing numeric handle, and only reads it. In particular
 * it does not fix its flags or demand that an unrelated file be our fixed file.
 * A failed inspection stops, with the exact failing native call recorded.
 */
static bool observe(view *current, transcript *out, purpose use, bool set_flags) {
  current->identified = false;
  current->non_inheritable = -1;
#ifdef _WIN32
  FILE_ID_INFO id;
  BOOL result = GetFileInformationByHandleEx(current->handle, FileIdInfo,
                                             &id, sizeof(id));
  DWORD error = result ? 0 : GetLastError();
  if (result) {
    static const char hex[] = "0123456789abcdef";
    unsigned_decimal(current->first, (uintmax_t)id.VolumeSerialNumber);
    for (size_t i = 0; i < 16; ++i) {
      current->second[2 * i] = hex[id.FileId.Identifier[i] >> 4];
      current->second[2 * i + 1] = hex[id.FileId.Identifier[i] & 15];
    }
    current->second[32] = '\0';
    current->identified = true;
  }
  signed_fact(out, "IDENTIFY", result, error, current);
  if (!result) return false;
  if (use != PARENT_DIRECTORY) {
    FILE_STANDARD_INFO standard;
    result = GetFileInformationByHandleEx(current->handle, FileStandardInfo,
                                          &standard, sizeof(standard));
    error = result ? 0 : GetLastError();
    signed_fact(out, "IDENTIFY", result, error, current);
    if (!result) return false;
    if (use == FIXED_FILE && (standard.Directory || standard.DeletePending ||
        standard.NumberOfLinks != 1 || standard.EndOfFile.QuadPart != 1)) return false;
  }
  FILE_ATTRIBUTE_TAG_INFO attributes;
  result = GetFileInformationByHandleEx(current->handle, FileAttributeTagInfo,
                                        &attributes, sizeof(attributes));
  error = result ? 0 : GetLastError();
  signed_fact(out, "IDENTIFY", result, error, current);
  if (!result) return false;
  if (use != INSPECTION) {
    if (attributes.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) return false;
    bool directory = (attributes.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
    if (directory != (use == PARENT_DIRECTORY)) return false;
  }
  if (use == PARENT_DIRECTORY) return true;
  if (set_flags) {
    result = SetHandleInformation(current->handle, HANDLE_FLAG_INHERIT, 0);
    error = result ? 0 : GetLastError();
    signed_fact(out, "FLAGS", result, error, current);
    if (!result) return false;
  }
  DWORD flags;
  result = GetHandleInformation(current->handle, &flags);
  error = result ? 0 : GetLastError();
  if (result) current->non_inheritable = !(flags & HANDLE_FLAG_INHERIT);
  signed_fact(out, "FLAGS", result, error, current);
  return result && (use == INSPECTION || current->non_inheritable == 1);
#else
  (void)set_flags;
  struct stat metadata;
  int result = fstat(current->handle, &metadata);
  int error = result == 0 ? 0 : errno;
  if (result == 0) {
    unsigned_decimal(current->first, NATIVE_UNSIGNED(metadata.st_dev));
    unsigned_decimal(current->second, NATIVE_UNSIGNED(metadata.st_ino));
    current->identified = true;
  }
  signed_fact(out, "IDENTIFY", result, (uintmax_t)error, current);
  if (result != 0) return false;
  if (use == PARENT_DIRECTORY) return S_ISDIR(metadata.st_mode);
  if (use == FIXED_FILE && (!S_ISREG(metadata.st_mode) ||
      metadata.st_nlink != 1 || metadata.st_size != 1)) return false;
  result = fcntl(current->handle, F_GETFD);
  error = result == -1 ? errno : 0;
  if (result != -1) current->non_inheritable = (result & FD_CLOEXEC) != 0;
  signed_fact(out, "FLAGS", result, (uintmax_t)error, current);
  return result != -1 && (use == INSPECTION || current->non_inheritable == 1);
#endif
}

static view open_native(const path_char *path, bool directory, transcript *out) {
#ifdef _WIN32
  HANDLE handle = CreateFileW(path,
      directory ? FILE_READ_ATTRIBUTES : GENERIC_READ | GENERIC_WRITE,
      FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING,
      directory ? FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT
                : FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT,
      NULL);
  DWORD error = handle == INVALID_HANDLE_VALUE ? GetLastError() : 0;
  view current = empty_view(handle, handle != INVALID_HANDLE_VALUE);
  handle_fact(out, handle, error, &current);
#else
  int handle = open(path, directory ? O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW
                                    : O_RDWR | O_CLOEXEC | O_NOFOLLOW);
  int error = handle == -1 ? errno : 0;
  view current = empty_view(handle, handle != -1);
  signed_fact(out, "OPEN", handle, (uintmax_t)error, &current);
#endif
  return current;
}
static bool lock_once(view *current, transcript *out, bool release) {
#ifdef _WIN32
  OVERLAPPED overlap;
  memset(&overlap, 0, sizeof(overlap));
  BOOL result = release ? UnlockFileEx(current->handle, 0, 1, 0, &overlap)
                        : LockFileEx(current->handle,
                            LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
                            0, 1, 0, &overlap);
  DWORD error = result ? 0 : GetLastError();
  signed_fact(out, release ? "UNLOCK" : "TRY_LOCK", result, error, current);
  return result != 0;
#else
  int result = flock(current->handle, release ? LOCK_UN : LOCK_EX | LOCK_NB);
  int error = result == 0 ? 0 : errno;
  signed_fact(out, release ? "UNLOCK" : "TRY_LOCK", result, (uintmax_t)error, current);
  return result == 0;
#endif
}

static napi_value string_value(napi_env env, const char *text) {
  napi_value value;
  API(napi_create_string_utf8(env, text, NAPI_AUTO_LENGTH, &value));
  return value;
}
/* Define own data properties: inherited JS setters must never reenter native
 * operations while diagnostic objects or their arrays are being constructed. */
static napi_status own_property(napi_env env, napi_value object, const char *key,
                                napi_value value) {
  napi_property_descriptor property = {0};
  property.utf8name = key;
  property.value = value;
  property.attributes = napi_default_jsproperty;
  return napi_define_properties(env, object, 1, &property);
}
static napi_value identity_value(napi_env env, const view *current) {
  napi_value identity;
  if (!current->identified) {
    API(napi_get_null(env, &identity));
    return identity;
  }
  API(napi_create_object(env, &identity));
#ifdef _WIN32
  const char *kind = "WINDOWS", *first = "volumeSerialNumber", *second = "fileIdHex";
#else
  const char *kind = "POSIX", *first = "device", *second = "inode";
#endif
  napi_value value = string_value(env, kind);
  if (!value) return NULL;
  API(own_property(env, identity, "kind", value));
  value = string_value(env, current->first);
  if (!value) return NULL;
  API(own_property(env, identity, first, value));
  value = string_value(env, current->second);
  if (!value) return NULL;
  API(own_property(env, identity, second, value));
  return identity;
}
static napi_value facts_value(napi_env env, const transcript *out) {
  napi_value array;
  API(napi_create_array_with_length(env, out->length, &array));
  for (size_t i = 0; i < out->length; ++i) {
    const fact *entry = &out->items[i];
    napi_value object, value;
    API(napi_create_object(env, &object));
    const char *keys[] = {"operation", "returnValue", "errorCode"};
    const char *texts[] = {entry->operation, entry->result, entry->error};
    for (size_t j = 0; j < 3; ++j) {
      value = string_value(env, texts[j]);
      if (!value) return NULL;
      API(own_property(env, object, keys[j], value));
    }
    value = identity_value(env, &entry->snapshot);
    if (!value) return NULL;
    API(own_property(env, object, "identity", value));
    if (entry->snapshot.live) {
      char decimal[DECIMAL_SIZE];
#ifdef _WIN32
      unsigned_decimal(decimal, (uintmax_t)(uintptr_t)entry->snapshot.handle);
#else
      unsigned_decimal(decimal, (uintmax_t)entry->snapshot.handle);
#endif
      value = string_value(env, decimal);
      if (!value) return NULL;
    } else API(napi_get_null(env, &value));
    API(own_property(env, object, "nativeHandle", value));
    if (entry->snapshot.non_inheritable == -1) API(napi_get_null(env, &value));
    else API(napi_get_boolean(env, entry->snapshot.non_inheritable == 1, &value));
    API(own_property(env, object, "nonInheritable", value));
    char index[DECIMAL_SIZE];
    unsigned_decimal(index, (uintmax_t)i);
    API(own_property(env, array, index, object));
  }
  return array;
}
static witness *arguments(napi_env env, napi_callback_info info, size_t expected,
                          napi_value *argument) {
  napi_value values[2];
  size_t count = 2;
  void *data = NULL;
  if (napi_get_cb_info(env, info, &count, values, NULL, &data) != napi_ok) {
    api_error(env); return NULL;
  }
  witness *owner = data;
  if (count != expected || owner->busy) { type_error(env); return NULL; }
  if (expected) *argument = values[0];
  return owner;
}
static bool valid_handle(napi_env env, witness *owner, napi_value supplied) {
  napi_valuetype type;
  bool tagged = false, equal = false;
  napi_value original;
  if (!owner->brand || !owner->file.live ||
      napi_typeof(env, supplied, &type) != napi_ok || type != napi_object ||
      napi_check_object_type_tag(env, supplied, &handle_tag, &tagged) != napi_ok || !tagged ||
      napi_get_reference_value(env, owner->brand, &original) != napi_ok ||
      napi_strict_equals(env, supplied, original, &equal) != napi_ok || !equal) {
    type_error(env); return false;
  }
  return true;
}
static bool separator(path_char ch) {
#ifdef _WIN32
  return ch == L'/' || ch == L'\\';
#else
  return ch == '/';
#endif
}
/* Validate before binding or making an OS call. Refuse malformed UTF-16 rather
 * than allowing a replacement character to address another POSIX pathname.
 */
static path_char *fixed_path(napi_env env, napi_value value, path_char **parent) {
  napi_valuetype type;
  size_t length = 0, copied = 0;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string ||
      napi_get_value_string_utf16(env, value, NULL, 0, &length) != napi_ok || !length ||
      length > (SIZE_MAX / sizeof(char16_t)) - 1) { type_error(env); return NULL; }
  char16_t *wide = calloc(length + 1, sizeof(char16_t));
  if (!wide) { api_error(env); return NULL; }
  if (napi_get_value_string_utf16(env, value, wide, length + 1, &copied) != napi_ok ||
      copied != length) { free(wide); api_error(env); return NULL; }
  for (size_t i = 0; i < length; ++i) {
    unsigned ch = wide[i];
    if (!ch || (ch >= 0xdc00 && ch <= 0xdfff)) goto invalid_wide;
    if (ch >= 0xd800 && ch <= 0xdbff) {
      if (++i == length || wide[i] < 0xdc00 || wide[i] > 0xdfff) goto invalid_wide;
    }
  }
  path_char *path;
#ifdef _WIN32
  path = (path_char *)wide;
  bool drive = length >= 3 && ((path[0] >= L'A' && path[0] <= L'Z') ||
      (path[0] >= L'a' && path[0] <= L'z')) && path[1] == L':' && separator(path[2]);
  bool unc = length >= 5 && path[0] == L'\\' && path[1] == L'\\' &&
      path[2] != L'?' && path[2] != L'.' && !separator(path[2]);
  if (!drive && !unc) goto invalid_path;
  /* No alternate streams or device namespaces. Require a UNC server/share/leaf. */
  size_t unc_separators = 0;
  for (size_t i = 2; i < length; ++i) {
    if (path[i] == L':') goto invalid_path;
    if (separator(path[i])) ++unc_separators;
  }
  if (unc && unc_separators < 2) goto invalid_path;
#else
  free(wide);
  wide = NULL;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok ||
      length == SIZE_MAX) { api_error(env); return NULL; }
  path = calloc(length + 1, 1);
  if (!path) { api_error(env); return NULL; }
  if (napi_get_value_string_utf8(env, value, path, length + 1, &copied) != napi_ok ||
      copied != length) { free(path); api_error(env); return NULL; }
  if (path[0] != '/') goto invalid_path;
#endif
  if (separator(path[length - 1])) goto invalid_path;
  size_t last = length;
  while (last && !separator(path[last - 1])) --last;
  if (!last) goto invalid_path;
  /* Dot components would make textual parent custody ambiguous. */
  for (size_t i = 0; i < length;) {
    if (separator(path[i])) { ++i; continue; }
    size_t start = i;
    while (i < length && !separator(path[i])) ++i;
    if ((i - start == 1 && path[start] == '.') ||
        (i - start == 2 && path[start] == '.' && path[start + 1] == '.')) goto invalid_path;
  }
  size_t parent_length = last - 1;
  if (parent_length == 0) parent_length = 1;
#ifdef _WIN32
  if (drive && parent_length == 2) parent_length = 3;
#endif
  *parent = calloc(parent_length + 1, sizeof(path_char));
  if (!*parent) { free(path); api_error(env); return NULL; }
  memcpy(*parent, path, parent_length * sizeof(path_char));
  return path;
invalid_path:
  free(path); type_error(env); return NULL;
invalid_wide:
  free(wide); type_error(env); return NULL;
}
static napi_value open_fixed(napi_env env, napi_callback_info info) {
  napi_value argument;
  witness *owner = arguments(env, info, 1, &argument);
  if (!owner) return NULL;
  if (owner->state != UNOPENED) return type_error(env);
  path_char *parent = NULL;
  path_char *path = fixed_path(env, argument, &parent);
  if (!path) return NULL;
  owner->busy = true;
  owner->state = CLOSED; /* A valid attempt consumes the single lifetime binding. */
  owner->parent = parent;
  transcript out = {0};
  owner->file = open_native(path, false, &out);
  free(path);
  bool usable = owner->file.live && observe(&owner->file, &out, FIXED_FILE, true);
  if (!usable && owner->file.live) close_once(&owner->file, &out);
  owner->busy = false;
  napi_value handle, result, facts;
  API(napi_get_null(env, &handle));
  if (usable) {
    /* If JS allocation fails, no handle is published; cleanup is not evidence. */
    if (napi_create_object(env, &handle) != napi_ok ||
        napi_type_tag_object(env, handle, &handle_tag) != napi_ok ||
        napi_object_freeze(env, handle) != napi_ok ||
        napi_create_reference(env, handle, 1, &owner->brand) != napi_ok) {
      close_once(&owner->file, NULL); return api_error(env);
    }
    owner->state = OPEN;
    owner->bound = true;
  }
  API(napi_create_object(env, &result));
  API(own_property(env, result, "handle", handle));
  facts = facts_value(env, &out);
  if (!facts) return NULL;
  API(own_property(env, result, "facts", facts));
  return result;
}
static napi_value handle_operation(napi_env env, napi_callback_info info, int operation) {
  napi_value supplied;
  witness *owner = arguments(env, info, 1, &supplied);
  if (!owner || !valid_handle(env, owner, supplied)) return NULL;
  if ((operation == 0 && owner->state != OPEN) ||
      (operation == 1 && owner->state != LOCKED) ||
      (operation == 2 && owner->state != OPEN) ||
      (operation == 3 && owner->state != OPEN && owner->state != LOCKED)) return type_error(env);
  owner->busy = true;
  transcript out = {0};
  if (operation <= 1) {
    if (lock_once(&owner->file, &out, operation == 1)) owner->state = operation ? OPEN : LOCKED;
  } else if (operation == 2) {
    owner->state = CLOSED;
    napi_ref brand = owner->brand;
    owner->brand = NULL; /* Invalidate before the one close attempt. */
    close_once(&owner->file, &out);
    if (napi_delete_reference(env, brand) != napi_ok) {
      owner->busy = false; return api_error(env);
    }
  } else observe(&owner->file, &out, FIXED_FILE, false);
  owner->busy = false;
  return facts_value(env, &out);
}
static napi_value try_lock(napi_env env, napi_callback_info info) {
  return handle_operation(env, info, 0);
}
static napi_value release_lock(napi_env env, napi_callback_info info) {
  return handle_operation(env, info, 1);
}
static napi_value close_fixed(napi_env env, napi_callback_info info) {
  return handle_operation(env, info, 2);
}
static napi_value describe_fixed(napi_env env, napi_callback_info info) {
  return handle_operation(env, info, 3);
}
static napi_value inspect_handle(napi_env env, napi_callback_info info) {
  napi_value supplied;
  witness *owner = arguments(env, info, 1, &supplied);
  if (!owner) return NULL;
  napi_valuetype type;
  size_t length = 0, copied = 0;
  char text[DECIMAL_SIZE];
  if (napi_typeof(env, supplied, &type) != napi_ok || type != napi_string ||
      napi_get_value_string_utf8(env, supplied, NULL, 0, &length) != napi_ok ||
      !length || length >= sizeof(text) ||
      napi_get_value_string_utf8(env, supplied, text, sizeof(text), &copied) != napi_ok ||
      copied != length || (length > 1 && text[0] == '0')) return type_error(env);
#ifdef _WIN32
  const uintmax_t maximum = (uintmax_t)UINTPTR_MAX;
#else
  const uintmax_t maximum = INT_MAX;
#endif
  uintmax_t value = 0;
  for (size_t i = 0; i < length; ++i) {
    if (text[i] < '0' || text[i] > '9') return type_error(env);
    unsigned digit = (unsigned)(text[i] - '0');
    if (value > (maximum - digit) / 10) return type_error(env);
    value = value * 10 + digit;
  }
#ifdef _WIN32
  view inspected = empty_view((HANDLE)(uintptr_t)value, true);
#else
  view inspected = empty_view((int)value, true);
#endif
  owner->busy = true;
  transcript out = {0};
  observe(&inspected, &out, INSPECTION, false);
  /* A numeric input alone is not evidence that an open handle exists. */
  if (!inspected.identified) {
    for (size_t i = 0; i < out.length; ++i) out.items[i].snapshot.live = false;
  }
  owner->busy = false;
  return facts_value(env, &out);
}
static napi_value describe_custody(napi_env env, napi_callback_info info) {
  witness *owner = arguments(env, info, 0, NULL);
  if (!owner) return NULL;
  if (!owner->bound) return type_error(env);
  owner->busy = true;
  transcript out = {0};
  view directory = open_native(owner->parent, true, &out);
  bool accepted = false;
  if (directory.live) {
    accepted = observe(&directory, &out, PARENT_DIRECTORY, false);
    bool closed = close_once(&directory, &out);
    accepted = accepted && closed;
  }
  owner->busy = false;
  /* Reviewed custody-only wrapper: native-success policy refusals retain the
   * exact native facts but cannot expose an accepted directory identity. */
  napi_value result, identity, facts;
  API(napi_create_object(env, &result));
  if (accepted) identity = identity_value(env, &directory);
  else API(napi_get_null(env, &identity));
  if (!identity) return NULL;
  API(own_property(env, result, "identity", identity));
  facts = facts_value(env, &out);
  if (!facts) return NULL;
  API(own_property(env, result, "facts", facts));
  return result;
}
static void cleanup(void *data) {
  witness *owner = data;
  environment_witness = NULL;
  owner->state = CLOSED;
  if (owner->file.live) close_once(&owner->file, NULL);
  free(owner->parent);
  free(owner);
}
static napi_value initialize(napi_env env, napi_value exports) {
  if (environment_witness) return type_error(env);
  witness *owner = calloc(1, sizeof(*owner));
  if (!owner) return api_error(env);
  owner->file.non_inheritable = -1;
  if (napi_add_env_cleanup_hook(env, cleanup, owner) != napi_ok) {
    free(owner); return api_error(env);
  }
  environment_witness = owner;
  const struct { const char *name; napi_callback callback; } functions[] = {
    {"openFixedLock", open_fixed}, {"tryLock", try_lock}, {"release", release_lock},
    {"close", close_fixed}, {"describe", describe_fixed},
    {"inspectNativeHandle", inspect_handle}, {"describeCustody", describe_custody}
  };
  napi_value value = string_value(env, INTERFACE);
  if (!value) return NULL;
  API(own_property(env, exports, "interfaceVersion", value));
  for (size_t i = 0; i < sizeof(functions) / sizeof(functions[0]); ++i) {
    API(napi_create_function(env, functions[i].name, NAPI_AUTO_LENGTH,
                             functions[i].callback, owner, &value));
    API(own_property(env, exports, functions[i].name, value));
  }
  API(napi_object_freeze(env, exports));
  return exports;
}
NAPI_MODULE(iss022_stable_native_lock_witness, initialize)
