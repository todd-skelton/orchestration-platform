#include "../../packages/conformance/src/windows-isolation-broker.c"

__declspec(noreturn) void fixture_entry(void) {
  WCHAR *mode = NULL;
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
  BYTE marker = 1U;
  BYTE release = 0U;
  DWORD transferred = 0U;
  if (!parse_mode(GetCommandLineW(), &mode)) ExitProcess(64U);
  if (wide_equal(mode, L"SUCCESS")) {
    if (!retain_module_custody() || !verify_module_custody() ||
        !release_module_custody())
      ExitProcess(1U);
    ExitProcess(0U);
  }
  if (wide_equal(mode, L"REFUSE"))
    ExitProcess(retain_module_custody() ? 2U : 0U);
  if (wide_equal(mode, L"DRIFT")) {
    if (!retain_module_custody() || output == NULL ||
        output == INVALID_HANDLE_VALUE ||
        !WriteFile(output, &marker, 1U, &transferred, NULL) ||
        transferred != 1U || input == NULL || input == INVALID_HANDLE_VALUE ||
        !ReadFile(input, &release, 1U, &transferred, NULL) ||
        transferred != 1U || release != 1U)
      ExitProcess(3U);
    if (verify_module_custody() || release_module_custody()) ExitProcess(4U);
    ExitProcess(0U);
  }
  ExitProcess(64U);
}
