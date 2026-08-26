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
typedef char CHAR;
typedef unsigned long long SIZE_T;

#define WINAPI __stdcall
#define NULL ((void *)0)
#define INVALID_HANDLE_VALUE ((HANDLE)(~(SIZE_T)0))
#define STD_ERROR_HANDLE ((DWORD)-12)

__declspec(dllimport) WCHAR *WINAPI GetCommandLineW(void);
__declspec(dllimport) HANDLE WINAPI GetStdHandle(DWORD standard_handle);
__declspec(dllimport) BOOL WINAPI WriteFile(
  HANDLE file,
  LPCVOID buffer,
  DWORD bytes_to_write,
  DWORD *bytes_written,
  LPVOID overlapped
);
__declspec(dllimport) __declspec(noreturn) void WINAPI ExitProcess(DWORD exit_code);

#define EXIT_ARGUMENT_REFUSED 64U
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
  static const CHAR serve_error[] = "windows-broker:serve-not-implemented\n";
  static const CHAR recover_error[] = "windows-broker:recover-not-implemented\n";
  WCHAR *mode = NULL;

  if (image_relocation_anchor == NULL) ExitProcess(EXIT_ARGUMENT_REFUSED);
  if (!parse_mode(GetCommandLineW(), &mode)) {
    diagnostic(argument_error, (DWORD)(sizeof(argument_error) - 1));
    ExitProcess(EXIT_ARGUMENT_REFUSED);
  }
  if (same_text(mode, serve_mode)) {
    diagnostic(serve_error, (DWORD)(sizeof(serve_error) - 1));
    ExitProcess(EXIT_LIFECYCLE_NOT_IMPLEMENTED);
  }
  if (same_text(mode, recover_mode)) {
    diagnostic(recover_error, (DWORD)(sizeof(recover_error) - 1));
    ExitProcess(EXIT_LIFECYCLE_NOT_IMPLEMENTED);
  }
  diagnostic(argument_error, (DWORD)(sizeof(argument_error) - 1));
  ExitProcess(EXIT_ARGUMENT_REFUSED);
}
