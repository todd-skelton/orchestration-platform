#if !defined(_WIN32)
#error "windows-isolation-broker.c is Windows-only"
#endif

#if !defined(_M_X64) && !defined(__x86_64__)
#error "windows-isolation-broker.c requires X64"
#endif

typedef void *HANDLE;
typedef const void *LPCVOID;
typedef void *LPVOID;
typedef unsigned long DWORD;
typedef int BOOL;
typedef unsigned short WCHAR;
typedef unsigned char BYTE;
typedef char CHAR;
typedef unsigned long long SIZE_T;

#define WINAPI __stdcall
#define NULL ((void *)0)
#define INVALID_HANDLE_VALUE ((HANDLE)(~(SIZE_T)0))
#define STD_ERROR_HANDLE ((DWORD)-12)
#define STD_INPUT_HANDLE ((DWORD)-10)
#define STD_OUTPUT_HANDLE ((DWORD)-11)

#define BROKER_FRAME_BYTES 16U
#define BROKER_MAXIMUM_PAYLOAD_BYTES (1024U * 1024U)
#define BROKER_REQUEST_KIND 1U
#define BROKER_RESPONSE_KIND 2U
#define BROKER_PROTOCOL_VERSION 1U
#define BROKER_PREPARE_OPERATION 1U
#define BROKER_LAUNCH_OPERATION 2U
#define BROKER_TEARDOWN_OPERATION 3U

__declspec(dllimport) WCHAR *WINAPI GetCommandLineW(void);
__declspec(dllimport) HANDLE WINAPI GetStdHandle(DWORD standard_handle);
__declspec(dllimport) BOOL WINAPI ReadFile(
  HANDLE file,
  LPVOID buffer,
  DWORD bytes_to_read,
  DWORD *bytes_read,
  LPVOID overlapped
);
__declspec(dllimport) BOOL WINAPI WriteFile(
  HANDLE file,
  LPCVOID buffer,
  DWORD bytes_to_write,
  DWORD *bytes_written,
  LPVOID overlapped
);
__declspec(dllimport) __declspec(noreturn) void WINAPI ExitProcess(DWORD exit_code);

#define EXIT_ARGUMENT_REFUSED 64U
#define EXIT_PROTOCOL_REFUSED 65U
#define EXIT_LIFECYCLE_NOT_IMPLEMENTED 78U

static const WCHAR serve_mode[] = L"SERVE";
static const WCHAR recover_mode[] = L"RECOVER";
static const void *volatile image_relocation_anchor = serve_mode;

static int same_text(const WCHAR *left, const WCHAR *right) {
  SIZE_T index = 0;
  while (left[index] != L'\0' && right[index] != L'\0') {
    if (left[index] != right[index]) return 0;
    index += 1;
  }
  return left[index] == right[index];
}

static void write_all(HANDLE output, const CHAR *bytes, DWORD length) {
  DWORD offset = 0;
  while (offset < length) {
    DWORD written = 0;
    if (!WriteFile(output, bytes + offset, length - offset, &written, NULL) || written == 0)
      ExitProcess(EXIT_ARGUMENT_REFUSED);
    offset += written;
  }
}

static void diagnostic(const CHAR *bytes, DWORD length) {
  HANDLE error_output = GetStdHandle(STD_ERROR_HANDLE);
  if (error_output != NULL && error_output != INVALID_HANDLE_VALUE)
    write_all(error_output, bytes, length);
}

static int read_exact(HANDLE input, BYTE *bytes, DWORD length) {
  DWORD offset = 0;
  while (offset < length) {
    DWORD received = 0;
    if (!ReadFile(input, bytes + offset, length - offset, &received, NULL) || received == 0)
      return 0;
    offset += received;
  }
  return 1;
}

static DWORD read_little_u32(const BYTE *bytes) {
  return
    ((DWORD)bytes[0]) |
    ((DWORD)bytes[1] << 8U) |
    ((DWORD)bytes[2] << 16U) |
    ((DWORD)bytes[3] << 24U);
}

static int known_operation(BYTE operation) {
  return
    operation == BROKER_PREPARE_OPERATION ||
    operation == BROKER_LAUNCH_OPERATION ||
    operation == BROKER_TEARDOWN_OPERATION;
}

static __declspec(noreturn) void protocol_refused(void) {
  static const CHAR protocol_error[] = "windows-broker:protocol\n";
  diagnostic(protocol_error, (DWORD)(sizeof(protocol_error) - 1));
  ExitProcess(EXIT_PROTOCOL_REFUSED);
}

static __declspec(noreturn) void serve(void) {
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
  BYTE header[BROKER_FRAME_BYTES];
  static BYTE scratch[4096];
  DWORD remaining;

  if (
    input == NULL || input == INVALID_HANDLE_VALUE ||
    output == NULL || output == INVALID_HANDLE_VALUE ||
    !read_exact(input, header, BROKER_FRAME_BYTES)
  )
    protocol_refused();
  if (
    header[0] != 'O' || header[1] != 'P' || header[2] != 'W' || header[3] != 'B' ||
    header[4] != BROKER_PROTOCOL_VERSION || header[5] != BROKER_REQUEST_KIND ||
    !known_operation(header[6]) || header[7] != 0U ||
    read_little_u32(header + 12) != 0U
  )
    protocol_refused();
  remaining = read_little_u32(header + 8);
  if (remaining > BROKER_MAXIMUM_PAYLOAD_BYTES) protocol_refused();
  while (remaining > 0U) {
    DWORD chunk = remaining < (DWORD)sizeof(scratch) ? remaining : (DWORD)sizeof(scratch);
    if (!read_exact(input, scratch, chunk)) protocol_refused();
    remaining -= chunk;
  }

  header[5] = BROKER_RESPONSE_KIND;
  header[7] = (BYTE)EXIT_LIFECYCLE_NOT_IMPLEMENTED;
  header[8] = 0U;
  header[9] = 0U;
  header[10] = 0U;
  header[11] = 0U;
  write_all(output, (const CHAR *)header, BROKER_FRAME_BYTES);
  ExitProcess(EXIT_LIFECYCLE_NOT_IMPLEMENTED);
}

static int parse_mode(WCHAR *command_line, WCHAR **mode) {
  WCHAR *cursor = command_line;
  if (*cursor == L'"') {
    cursor += 1;
    while (*cursor != L'\0' && *cursor != L'"') cursor += 1;
    if (*cursor != L'"') return 0;
    cursor += 1;
  } else {
    while (*cursor != L'\0' && *cursor != L' ' && *cursor != L'\t') cursor += 1;
  }
  if (*cursor != L' ' && *cursor != L'\t') return 0;
  while (*cursor == L' ' || *cursor == L'\t') cursor += 1;
  if (*cursor == L'\0') return 0;
  *mode = cursor;
  while (*cursor != L'\0' && *cursor != L' ' && *cursor != L'\t') cursor += 1;
  if (*cursor != L'\0') return 0;
  return 1;
}

__declspec(noreturn) void broker_entry(void) {
  static const CHAR argument_error[] = "windows-broker:arguments\n";
  static const CHAR recover_error[] = "windows-broker:recover-not-implemented\n";
  WCHAR *mode = NULL;

  if (image_relocation_anchor == NULL) ExitProcess(EXIT_ARGUMENT_REFUSED);
  if (!parse_mode(GetCommandLineW(), &mode)) {
    diagnostic(argument_error, (DWORD)(sizeof(argument_error) - 1));
    ExitProcess(EXIT_ARGUMENT_REFUSED);
  }
  if (same_text(mode, serve_mode)) {
    serve();
  }
  if (same_text(mode, recover_mode)) {
    diagnostic(recover_error, (DWORD)(sizeof(recover_error) - 1));
    ExitProcess(EXIT_LIFECYCLE_NOT_IMPLEMENTED);
  }
  diagnostic(argument_error, (DWORD)(sizeof(argument_error) - 1));
  ExitProcess(EXIT_ARGUMENT_REFUSED);
}
