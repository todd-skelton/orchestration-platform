#define OP_WINDOWS_BROKER_FIXTURE 1
#if !defined(OP_WINDOWS_ABSENCE_VERIFIER)
#define NetworkIsolationEnumAppContainers fixture_enum_appcontainers
#define NetworkIsolationFreeAppContainers fixture_free_appcontainers
#endif
#include "../../packages/conformance/src/windows-isolation-broker.c"

#if defined(OP_WINDOWS_FAULT_FIXTURE)
#undef CreateFileW
#undef WriteFile
#undef ReadFile
#undef FlushFileBuffers
#undef GetFileInformationByHandle
#undef GetFileInformationByHandleEx
#undef SetFileInformationByHandle
#undef GetFileAttributesW
#undef CloseHandle
#undef FindClose
#undef HeapFree
#undef LocalFree
#undef FreeSid
#undef BCryptDestroyHash
#undef BCryptCloseAlgorithmProvider
#endif

#if defined(OP_WINDOWS_PROFILE_FIXTURE)
#undef CreateAppContainerProfile
#undef DeleteAppContainerProfile
#undef GetAppContainerFolderPath
#undef CreateFileW
#undef CloseHandle
#undef GetFileInformationByHandle
#undef GetFileInformationByHandleEx
#undef GetSecurityInfo
#undef WriteFile
#undef FreeSid
#endif

#if defined(OP_WINDOWS_ABSENCE_VERIFIER)

__declspec(noreturn) void verifier_entry(void) {
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  BYTE header[72];
  BYTE sid[SID_MAX_BYTES];
  WCHAR moniker[MONIKER_BYTES + 1U];
  WCHAR folder[PATH_MAX_UNITS + 1U];
  WORD sid_length;
  WORD folder_units;
  BYTE trailing;
  DWORD index;
  DWORD count = 0U;
  PINET_FIREWALL_APP_CONTAINER rows = NULL;
  int absent = 1;
  HANDLE folder_handle;
  DWORD folder_error;
  if (input == NULL || input == INVALID_HANDLE_VALUE || !read_exact(input, header, sizeof(header)) ||
      header[0] != 'O' || header[1] != 'P' || header[2] != 'W' || header[3] != 'V')
    ExitProcess(1U);
  sid_length = read_u16(header + 4U);
  folder_units = read_u16(header + 6U);
  if (sid_length < 8U || sid_length > SID_MAX_BYTES || folder_units < 8U ||
      folder_units > PATH_MAX_UNITS)
    ExitProcess(1U);
  for (index = 0U; index < MONIKER_BYTES; index += 1U) {
    if (header[8U + index] > 127U) ExitProcess(1U);
    moniker[index] = (WCHAR)header[8U + index];
  }
  moniker[MONIKER_BYTES] = L'\0';
  if (!read_exact(input, sid, sid_length) || !IsValidSid(sid) ||
      GetLengthSid(sid) != sid_length ||
      !read_exact(input, (BYTE *)folder, (DWORD)folder_units * 2U))
    ExitProcess(1U);
  folder[folder_units] = L'\0';
  if (!canonical_folder_path(folder, folder_units) || read_one(input, &trailing) != 0)
    ExitProcess(1U);
  if (NetworkIsolationEnumAppContainers(NETISO_FLAG_FORCE_COMPUTE_BINARIES,
                                        &count, &rows) != ERROR_SUCCESS ||
      count > CENSUS_MAXIMUM || (count == 0U && rows != NULL) ||
      (count != 0U && rows == NULL))
    ExitProcess(1U);
  for (index = 0U; index < count; index += 1U) {
    SIZE_T name_units = 0U;
    DWORD row_sid_length;
    if (rows[index].appContainerName == NULL || rows[index].appContainerSid == NULL ||
        !bounded_wide_length(rows[index].appContainerName, PATH_MAX_UNITS, &name_units) ||
        !IsValidSid(rows[index].appContainerSid)) {
      absent = 0;
      break;
    }
    row_sid_length = GetLengthSid(rows[index].appContainerSid);
    if (wide_equal(rows[index].appContainerName, moniker) ||
        (row_sid_length == sid_length && equal_bytes(rows[index].appContainerSid, sid, sid_length))) {
      absent = 0;
      break;
    }
  }
  if (rows != NULL && NetworkIsolationFreeAppContainers(rows) != ERROR_SUCCESS) absent = 0;
  folder_handle = CreateFileW(folder, FILE_READ_ATTRIBUTES,
                              FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                              NULL, OPEN_EXISTING,
                              FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  if (folder_handle != INVALID_HANDLE_VALUE) {
    if (!CloseHandle(folder_handle)) absent = 0;
    absent = 0;
  } else {
    folder_error = GetLastError();
    if (folder_error != ERROR_FILE_NOT_FOUND && folder_error != ERROR_PATH_NOT_FOUND) absent = 0;
  }
  ExitProcess(absent ? 0U : 1U);
}

#else

#define FIXTURE_ENUM_ERROR 1U
#define FIXTURE_ENUM_OVERBOUND 2U
#define FIXTURE_UNRELATED_DUPLICATE 3U
#define FIXTURE_UNRELATED_NAME_CONFLICT 4U
#define FIXTURE_UNRELATED_SID_CONFLICT 5U
#define FIXTURE_TARGET_ONE 6U
#define FIXTURE_TARGET_DUPLICATE 7U
#define FIXTURE_TARGET_NAME_ONLY 8U
#define FIXTURE_TARGET_SID_ONLY 9U
#define FIXTURE_TARGET_CAPABILITY 10U
#define FIXTURE_MALFORMED_LATE 11U
#define FIXTURE_FREE_ERROR 12U
#define FIXTURE_COMPLETE_EMPTY 13U
#define FIXTURE_COMPLETE_DUPLICATE 14U
#define FIXTURE_COMPLETE_UNJOURNALED 15U
#define FIXTURE_COMPLETE_TERMINAL 16U
#define FIXTURE_COMPLETE_GROUP_DUPLICATE 17U
#define FIXTURE_COMPLETE_CROSS_GROUP 18U
#define FIXTURE_POINTER_MISMATCH 19U
#define FIXTURE_RECORD_FOLDER_ARMS 20U
#define FIXTURE_TARGET_NULL_USER 21U
#define FIXTURE_TARGET_WRONG_USER 22U
#define FIXTURE_TARGET_MALFORMED_USER 23U
#define FIXTURE_LIFECYCLE_CLEAN 24U
#define FIXTURE_LIFECYCLE_CLEANUP_FAILURE 25U
#define FIXTURE_LIFECYCLE_ROOT_CLOSE_FAILURE 26U
#define FIXTURE_DURABLE_PUBLICATION 27U
#define FIXTURE_FAULT_PUBLICATION 28U
#define FIXTURE_FAULT_RESOURCES 29U
#define FIXTURE_PROFILE_CONTROL 30U
#define FIXTURE_MIXED_RECOVERY 31U
#define FIXTURE_SUBSTITUTION 32U

static DWORD fixture_scenario;
static DWORD fixture_free_calls;
static DWORD fixture_expected_rows;
static PROFILE_IDENTITY fixture_target;
static PROFILE_IDENTITY fixture_second_target;
static SID_AND_ATTRIBUTES fixture_capability;
static PSID fixture_stable_user;
static const WCHAR fixture_unrelated_a[] = L"fixture-unrelated-a";
static const WCHAR fixture_unrelated_b[] = L"fixture-unrelated-b";
static PSID fixture_sid(DWORD first, DWORD second);

#if defined(OP_WINDOWS_PROFILE_FIXTURE)

__declspec(dllimport) LPVOID WINAPI CoTaskMemAlloc(SIZE_T);
__declspec(dllimport) BOOL WINAPI GetSecurityDescriptorOwner(PSECURITY_DESCRIPTOR, PSID *, BOOL *);
__declspec(dllimport) BOOL WINAPI GetSecurityDescriptorDacl(PSECURITY_DESCRIPTOR, BOOL *, PACL *, BOOL *);
__declspec(dllimport) BOOL WINAPI GetSecurityDescriptorSacl(PSECURITY_DESCRIPTOR, BOOL *, PACL *, BOOL *);
__declspec(dllimport) BOOL WINAPI CreateDirectoryW(PCWSTR, SECURITY_ATTRIBUTES *);

#define PROFILE_FOLDER_HANDLE ((HANDLE)0x5151U)

static BYTE fixture_profile_case;
static int fixture_profile_present;
static int fixture_profile_folder_present;
static int fixture_profile_create_calls;
static int fixture_profile_delete_calls;
static int fixture_profile_close_calls;
static int fixture_profile_security_calls;
static int fixture_profile_file_info_calls;
static HANDLE fixture_profile_created_journal;
static int fixture_profile_forbidden_free_armed;
static int fixture_profile_forbidden_free_fired;
static ROOT_CUSTODY *fixture_profile_root;
static PROFILE_IDENTITY fixture_profile_identity;
static const WCHAR fixture_profile_folder[] = L"\\\\?\\C:\\fixture-profile";

static int fixture_profile_created_pending_path(PCWSTR path) {
  static const WCHAR ending[] = L"-02-profile-created.opwj.pending";
  SIZE_T path_units = wide_length(path);
  SIZE_T ending_units = wide_length(ending);
  if (path_units < ending_units) return 0;
  for (SIZE_T index = 0U; index < ending_units; index += 1U)
    if (path[path_units - ending_units + index] != ending[index]) return 0;
  return 1;
}

static PSID fixture_profile_sid_copy(const PROFILE_IDENTITY *identity) {
  PSID derived = NULL;
  if (FAILED(DeriveAppContainerSidFromAppContainerName(identity->moniker, &derived))) return NULL;
  return derived;
}

static PSID fixture_profile_wrong_sid(DWORD value) {
  SID_IDENTIFIER_AUTHORITY authority = SECURITY_NT_AUTHORITY;
  PSID sid = NULL;
  if (!AllocateAndInitializeSid(&authority, 2U, 21U, value, 0U, 0U, 0U, 0U, 0U, 0U,
                                &sid))
    return NULL;
  return sid;
}

static HRESULT WINAPI fixture_CreateAppContainerProfile(PCWSTR name, PCWSTR display,
                                                        PCWSTR description,
                                                        SID_AND_ATTRIBUTES *capabilities,
                                                        DWORD capability_count, PSID *returned) {
  fixture_profile_create_calls += 1;
  *returned = NULL;
  if (name == NULL || display == NULL || description == NULL) return (HRESULT)0x80070057L;
  if (fixture_profile_identity.moniker[0] == L'\0') {
    PSID derived = NULL;
    copy_bytes(fixture_profile_identity.moniker, name,
               ((DWORD)wide_length(name) + 1U) * 2U);
    if (FAILED(DeriveAppContainerSidFromAppContainerName(name, &derived)) || derived == NULL ||
        !identity_sid_text(fixture_profile_root, derived, &fixture_profile_identity)) {
      if (derived != NULL) FreeSid(derived);
      return (HRESULT)0x80070057L;
    }
    if (FreeSid(derived) != NULL) return (HRESULT)0x80070005L;
  }
  if (!wide_equal(display, name) || !wide_equal(description, name) ||
      capabilities != NULL || capability_count != 0U ||
      !wide_equal(name, fixture_profile_identity.moniker))
    return (HRESULT)0x80070057L;
  if (fixture_profile_case == 4U) return (HRESULT)0x80070005L;
  if (fixture_profile_present) return HRESULT_ALREADY_EXISTS;
  fixture_profile_present = 1;
  fixture_profile_folder_present = 1;
  if (fixture_profile_case == 5U) return 0;
  if (fixture_profile_case == 6U) {
    *returned = fixture_profile_wrong_sid(998U);
    if (*returned != NULL) ((BYTE *)*returned)[0] = 0U;
    return 0;
  }
  if (fixture_profile_case == 7U) {
    *returned = fixture_profile_wrong_sid(999U);
    return 0;
  }
  *returned = fixture_profile_sid_copy(&fixture_profile_identity);
  if (fixture_profile_case == 39U && *returned != NULL)
    fixture_profile_forbidden_free_armed = 1;
  return *returned == NULL ? (HRESULT)0x8007000eL : 0;
}

static PVOID WINAPI fixture_profile_FreeSid(PSID sid) {
  PVOID result = FreeSid(sid);
  if (fixture_profile_forbidden_free_armed && !fixture_profile_forbidden_free_fired) {
    fixture_profile_forbidden_free_fired = 1;
    return sid;
  }
  return result;
}

static HRESULT WINAPI fixture_DeleteAppContainerProfile(PCWSTR name) {
  fixture_profile_delete_calls += 1;
  if (!wide_equal(name, fixture_profile_identity.moniker)) return (HRESULT)0x80070057L;
  if (fixture_profile_case == 30U && fixture_profile_delete_calls == 1) {
    fixture_profile_present = 1;
    fixture_profile_folder_present = 1;
  } else if (fixture_profile_case == 31U && fixture_profile_delete_calls == 1) {
    fixture_profile_present = 0;
    fixture_profile_folder_present = 1;
  } else {
    fixture_profile_present = 0;
    fixture_profile_folder_present = 0;
  }
  return fixture_profile_case == 29U ? (HRESULT)0x80070005L : 0;
}

static HRESULT WINAPI fixture_GetAppContainerFolderPath(PCWSTR sid_text, PWSTR *folder) {
  SIZE_T units;
  WCHAR expected[SID_TEXT_MAX_BYTES + 1U];
  DWORD index;
  *folder = NULL;
  if (sid_text == NULL) return (HRESULT)0x80070057L;
  for (index = 0U; index < fixture_profile_identity.sid_text_length; index += 1U)
    expected[index] = (WCHAR)(BYTE)fixture_profile_identity.sid_text[index];
  expected[fixture_profile_identity.sid_text_length] = L'\0';
  if (!wide_equal(sid_text, expected)) return (HRESULT)0x80070057L;
  if (fixture_profile_case == 8U) return (HRESULT)0x80070005L;
  units = wide_length(fixture_profile_folder + 4U);
  *folder = CoTaskMemAlloc((units + 1U) * 2U);
  if (*folder == NULL) return (HRESULT)0x8007000eL;
  copy_bytes(*folder, fixture_profile_folder + 4U, (units + 1U) * 2U);
  if (fixture_profile_case == 9U) (*folder)[0] = L'c';
  return 0;
}

static HANDLE WINAPI fixture_profile_CreateFileW(PCWSTR path, DWORD access, DWORD sharing,
                                                  SECURITY_ATTRIBUTES *attributes, DWORD creation,
                                                  DWORD flags, HANDLE template_file) {
  if (wide_equal(path, fixture_profile_folder)) {
    DWORD expected_access = fixture_profile_folder_present ?
                              (FILE_READ_ATTRIBUTES | READ_CONTROL) : FILE_READ_ATTRIBUTES;
    if (access != expected_access || sharing != FILE_SHARE_READ ||
        attributes != NULL || creation != OPEN_EXISTING ||
        flags != (FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT) ||
        template_file != NULL) {
      SetLastError(5U);
      return INVALID_HANDLE_VALUE;
    }
    if (!fixture_profile_folder_present || fixture_profile_case == 10U) {
      SetLastError(ERROR_FILE_NOT_FOUND);
      return INVALID_HANDLE_VALUE;
    }
    return PROFILE_FOLDER_HANDLE;
  }
  {
    HANDLE result = CreateFileW(path, access, sharing, attributes, creation, flags, template_file);
    if (result != INVALID_HANDLE_VALUE && fixture_profile_created_pending_path(path))
      fixture_profile_created_journal = result;
    return result;
  }
}

static BOOL WINAPI fixture_profile_WriteFile(HANDLE handle, LPCVOID bytes, DWORD length,
                                              DWORD *written, LPVOID overlapped) {
  if (fixture_profile_case == 34U && handle == fixture_profile_created_journal)
    return FALSE;
  return WriteFile(handle, bytes, length, written, overlapped);
}

static BOOL WINAPI fixture_profile_CloseHandle(HANDLE handle) {
  if (handle == PROFILE_FOLDER_HANDLE) {
    fixture_profile_close_calls += 1;
    return fixture_profile_case == 28U ? FALSE : TRUE;
  }
  return CloseHandle(handle);
}

static BOOL WINAPI fixture_profile_GetFileInformationByHandleEx(HANDLE handle,
                                                                 FILE_INFO_BY_HANDLE_CLASS kind,
                                                                 LPVOID output, DWORD length) {
  if (handle == PROFILE_FOLDER_HANDLE && kind == FileIdInfo && length == sizeof(FILE_ID_INFO)) {
    fixture_profile_file_info_calls += 1;
    zero_bytes(output, length);
    ((FILE_ID_INFO *)output)->VolumeSerialNumber = 7U;
    ((FILE_ID_INFO *)output)->FileId.Identifier[0] =
      fixture_profile_case == 14U && fixture_profile_file_info_calls > 1 ? 2U : 1U;
    return TRUE;
  }
  return GetFileInformationByHandleEx(handle, kind, output, length);
}

static BOOL WINAPI fixture_profile_GetFileInformationByHandle(
  HANDLE handle, BY_HANDLE_FILE_INFORMATION *information) {
  if (handle == PROFILE_FOLDER_HANDLE) {
    zero_bytes(information, sizeof(*information));
    information->dwFileAttributes = fixture_profile_case == 11U ? FILE_ATTRIBUTE_REPARSE_POINT :
                                    (fixture_profile_case == 12U ? FILE_ATTRIBUTE_NORMAL :
                                     FILE_ATTRIBUTE_DIRECTORY);
    information->nNumberOfLinks = fixture_profile_case == 13U ? 2U : 1U;
    return TRUE;
  }
  return GetFileInformationByHandle(handle, information);
}

static int fixture_rename_handle(HANDLE handle, const WCHAR *target) {
  DWORD target_bytes = (DWORD)wide_length(target) * 2U;
  DWORD bytes = (DWORD)sizeof(FILE_RENAME_INFO) + target_bytes;
  FILE_RENAME_INFO *rename = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, bytes);
  int result;
  if (rename == NULL) return 0;
  rename->ReplaceIfExists = (BOOL)FILE_RENAME_FLAG_POSIX_SEMANTICS;
  rename->RootDirectory = NULL;
  rename->FileNameLength = target_bytes;
  copy_bytes(rename->FileName, target, target_bytes);
  result = SetFileInformationByHandle(handle, FileRenameInfoEx, rename, bytes);
  if (!HeapFree(GetProcessHeap(), 0U, rename)) return 0;
  return result;
}

static DWORD WINAPI fixture_profile_GetSecurityInfo(HANDLE handle, SE_OBJECT_TYPE object_type,
                                                     DWORD requested, PSID *owner, PSID *group,
                                                     PACL *dacl, PACL *sacl,
                                                     PSECURITY_DESCRIPTOR *security) {
  LPWSTR stable = NULL;
  WCHAR package[SID_TEXT_MAX_BYTES + 1U];
  WCHAR sddl[2048];
  DWORD cursor = 0U;
  PCWSTR package_ace = L"(A;OICICR;FA;;;";
  PCWSTR label_ace = L"S:(ML;OICI;NW;;;LW)";
  BOOL present = FALSE;
  BOOL defaulted = FALSE;
  void *raw = NULL;
  if (handle != PROFILE_FOLDER_HANDLE)
    return GetSecurityInfo(handle, object_type, requested, owner, group, dacl, sacl, security);
  if (object_type != SE_FILE_OBJECT ||
      requested != (OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION |
                    LABEL_SECURITY_INFORMATION) ||
      owner == NULL || group != NULL || dacl == NULL || sacl == NULL || security == NULL)
    return 87U;
  fixture_profile_security_calls += 1;
  for (DWORD index = 0U; index < fixture_profile_identity.sid_text_length; index += 1U)
    package[index] = (WCHAR)(BYTE)fixture_profile_identity.sid_text[index];
  package[fixture_profile_identity.sid_text_length] = L'\0';
  if (!ConvertSidToStringSidW(fixture_profile_root->stable_sid, &stable)) return 5U;
  if (!append_wide(sddl, 2048U, &cursor, fixture_profile_case == 15U ? L"O:SY" : L"O:") ||
      (fixture_profile_case != 15U && !append_wide(sddl, 2048U, &cursor, stable)) ||
      !append_wide(sddl, 2048U, &cursor, L"G:SYD:"))
    goto failed;
  if (fixture_profile_case == 18U) package_ace = L"(D;OICICR;FA;;;";
  else if (fixture_profile_case == 20U) package_ace = L"(A;OICICRID;FA;;;";
  else if (fixture_profile_case == 35U) package_ace = L"(A;OICIIOCR;FA;;;";
  else if (fixture_profile_case == 36U) package_ace = L"(A;OICINPCR;FA;;;";
  if (fixture_profile_case != 16U) {
    if (!append_wide(sddl, 2048U, &cursor, package_ace) ||
        !append_wide(sddl, 2048U, &cursor, package) ||
        !append_wide(sddl, 2048U, &cursor, L")"))
      goto failed;
    if (fixture_profile_case == 17U &&
        (!append_wide(sddl, 2048U, &cursor, L"(A;OICICR;FA;;;") ||
         !append_wide(sddl, 2048U, &cursor, package) ||
         !append_wide(sddl, 2048U, &cursor, L")")))
      goto failed;
  }
  if (!append_wide(sddl, 2048U, &cursor, L"(A;OICIID;FA;;;") ||
      !append_wide(sddl, 2048U, &cursor, stable) ||
      !append_wide(sddl, 2048U, &cursor,
                   fixture_profile_case == 19U ?
                     L")(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;ID;GW;;;WD)" :
                     L")(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)"))
    goto failed;
  if (fixture_profile_case != 24U) {
    if (fixture_profile_case == 26U) label_ace = L"S:(ML;OICI;NW;;;HI)";
    else if (fixture_profile_case == 37U) label_ace = L"S:(ML;OICIID;NW;;;LW)";
    else if (fixture_profile_case == 38U) label_ace = L"S:(ML;OICIIO;NW;;;LW)";
    if (!append_wide(sddl, 2048U, &cursor, label_ace))
      goto failed;
    if (fixture_profile_case == 25U &&
        !append_wide(sddl, 2048U, &cursor, L"(ML;OICI;NW;;;LW)"))
      goto failed;
  }
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1,
                                                             security, NULL) ||
      !GetSecurityDescriptorOwner(*security, owner, &defaulted) ||
      !GetSecurityDescriptorDacl(*security, &present, dacl, &defaulted) || !present ||
      !GetSecurityDescriptorSacl(*security, &present, sacl, &defaulted))
    goto failed_security;
  if ((fixture_profile_case == 21U || fixture_profile_case == 22U ||
       fixture_profile_case == 23U) && GetAce(*dacl, 0U, &raw)) {
    ACCESS_ALLOWED_ACE *ace = (ACCESS_ALLOWED_ACE *)raw;
    if (fixture_profile_case == 21U) ace->Header.AceSize = 12U;
    if (fixture_profile_case == 22U) ((BYTE *)&ace->SidStart)[0] = 0U;
    if (fixture_profile_case == 23U) ace->Header.AceSize = 16U;
  }
  if (fixture_profile_case == 27U && fixture_profile_security_calls > 1)
    ((BYTE *)*security)[0] ^= 1U;
  if (LocalFree(stable) != NULL) return 5U;
  return ERROR_SUCCESS;
failed_security:
  if (*security != NULL) LocalFree(*security);
  *security = NULL;
failed:
  if (stable != NULL) LocalFree(stable);
  return 5U;
}

#endif

#if defined(OP_WINDOWS_FAULT_FIXTURE)

#define FAULT_PENDING_CREATE 1U
#define FAULT_WRITE 2U
#define FAULT_SHORT_WRITE 3U
#define FAULT_FILE_FLUSH 4U
#define FAULT_READBACK 5U
#define FAULT_FILE_BASIC 6U
#define FAULT_FILE_ID 7U
#define FAULT_RENAME 8U
#define FAULT_PENDING_ABSENCE 9U
#define FAULT_ROOT_FLUSH 10U
#define FAULT_CLOSE 11U
#define FAULT_FINAL_REOPEN 12U
#define FAULT_PRIOR_PARSE 13U
#define FAULT_FIND_CLOSE 14U
#define FAULT_ROOT_CLOSE 15U
#define FAULT_TOKEN_CLOSE 16U
#define FAULT_HEAP_FREE 17U
#define FAULT_LOCAL_FREE 18U
#define FAULT_SID_FREE 19U
#define FAULT_BCRYPT_HASH 20U
#define FAULT_BCRYPT_PROVIDER 21U
#define FAULT_SIMULTANEOUS 22U

static BYTE fixture_fault_active;
static BYTE fixture_fault_phase;
static BYTE fixture_fault_point;
static HANDLE fixture_fault_pending_handle;
static HANDLE fixture_fault_record_handle;
static HANDLE fixture_fault_root_handle;
static HANDLE fixture_fault_token_handle;
static DWORD fixture_fault_release_mask;

static int fixture_wide_units_equal(const WCHAR *left, const WCHAR *right, SIZE_T units) {
  for (SIZE_T index = 0U; index < units; index += 1U)
    if (left[index] != right[index]) return 0;
  return 1;
}

static BYTE fixture_path_phase(PCWSTR path, int *pending) {
  static const WCHAR *endings[] = {
    L"", L"-00-used.opwj", L"-01-profile-attempted.opwj",
    L"-02-profile-created.opwj", L"-03-profile-delete-attempted.opwj",
    L"-04-profile-absence-proved.opwj"
  };
  SIZE_T path_units = wide_length(path);
  *pending = 0;
  for (BYTE kind = JOURNAL_USED; kind <= JOURNAL_PROFILE_ABSENCE_PROVED; kind += 1U) {
    SIZE_T ending_units = wide_length(endings[kind]);
    if (path_units >= ending_units &&
        fixture_wide_units_equal(path + path_units - ending_units, endings[kind], ending_units))
      return kind;
    if (path_units >= ending_units + 8U &&
        wide_equal(path + path_units - 8U, L".pending") &&
        fixture_wide_units_equal(path + path_units - ending_units - 8U,
                                 endings[kind], ending_units)) {
      *pending = 1;
      return kind;
    }
  }
  return 0U;
}

static HANDLE WINAPI fixture_CreateFileW(PCWSTR path, DWORD access, DWORD sharing,
                                         SECURITY_ATTRIBUTES *attributes, DWORD creation,
                                         DWORD flags, HANDLE template_file) {
  int pending = 0;
  BYTE phase = fixture_path_phase(path, &pending);
  HANDLE result;
  if (fixture_fault_active && phase == fixture_fault_phase && pending &&
      creation == CREATE_NEW && fixture_fault_point == FAULT_PENDING_CREATE) {
    SetLastError(5U);
    return INVALID_HANDLE_VALUE;
  }
  if (fixture_fault_active && phase == fixture_fault_phase && !pending &&
      creation == OPEN_EXISTING && fixture_fault_point == FAULT_FINAL_REOPEN) {
    SetLastError(5U);
    return INVALID_HANDLE_VALUE;
  }
  result = CreateFileW(path, access, sharing, attributes, creation, flags, template_file);
  if (result != INVALID_HANDLE_VALUE && phase == fixture_fault_phase) {
    if (pending) fixture_fault_pending_handle = result;
    else fixture_fault_record_handle = result;
  }
  return result;
}

static BOOL WINAPI fixture_WriteFile(HANDLE file, LPCVOID bytes, DWORD length,
                                     DWORD *written, LPVOID overlapped) {
  if (fixture_fault_active && file == fixture_fault_pending_handle) {
    if (fixture_fault_point == FAULT_WRITE) return FALSE;
    if (fixture_fault_point == FAULT_SHORT_WRITE) {
      if (!WriteFile(file, bytes, length, written, overlapped)) return FALSE;
      if (*written != 0U) *written -= 1U;
      return TRUE;
    }
  }
  return WriteFile(file, bytes, length, written, overlapped);
}

static BOOL WINAPI fixture_ReadFile(HANDLE file, LPVOID bytes, DWORD length,
                                    DWORD *read, LPVOID overlapped) {
  BOOL result;
  if (fixture_fault_active && file == fixture_fault_pending_handle &&
      fixture_fault_point == FAULT_READBACK)
    return FALSE;
  result = ReadFile(file, bytes, length, read, overlapped);
  if (result && fixture_fault_active && file == fixture_fault_record_handle &&
      fixture_fault_point == FAULT_PRIOR_PARSE && *read > 44U)
    ((BYTE *)bytes)[44] ^= 1U;
  return result;
}

static BOOL WINAPI fixture_FlushFileBuffers(HANDLE file) {
  if (fixture_fault_active && file == fixture_fault_pending_handle &&
      fixture_fault_point == FAULT_FILE_FLUSH)
    return FALSE;
  if (fixture_fault_active && file == fixture_fault_root_handle &&
      fixture_fault_point == FAULT_ROOT_FLUSH)
    return FALSE;
  return FlushFileBuffers(file);
}

static BOOL WINAPI fixture_GetFileInformationByHandle(HANDLE file,
                                                       BY_HANDLE_FILE_INFORMATION *information) {
  if (fixture_fault_active && file == fixture_fault_pending_handle &&
      fixture_fault_point == FAULT_FILE_BASIC)
    return FALSE;
  return GetFileInformationByHandle(file, information);
}

static BOOL WINAPI fixture_GetFileInformationByHandleEx(HANDLE file,
                                                         FILE_INFO_BY_HANDLE_CLASS kind,
                                                         LPVOID information, DWORD length) {
  if (fixture_fault_active && file == fixture_fault_pending_handle &&
      kind == FileIdInfo && fixture_fault_point == FAULT_FILE_ID)
    return FALSE;
  return GetFileInformationByHandleEx(file, kind, information, length);
}

static BOOL WINAPI fixture_SetFileInformationByHandle(HANDLE file,
                                                       FILE_INFO_BY_HANDLE_CLASS kind,
                                                       LPVOID information, DWORD length) {
  if (fixture_fault_active && file == fixture_fault_pending_handle &&
      kind == FileRenameInfoEx && fixture_fault_point == FAULT_RENAME)
    return FALSE;
  return SetFileInformationByHandle(file, kind, information, length);
}

static DWORD WINAPI fixture_GetFileAttributesW(PCWSTR path) {
  int pending = 0;
  BYTE phase = fixture_path_phase(path, &pending);
  if (fixture_fault_active && phase == fixture_fault_phase && pending &&
      fixture_fault_point == FAULT_PENDING_ABSENCE)
    return FILE_ATTRIBUTE_NORMAL;
  return GetFileAttributesW(path);
}

static BOOL WINAPI fixture_CloseHandle(HANDLE file) {
  BOOL result = CloseHandle(file);
  if (fixture_fault_active &&
      (file == fixture_fault_pending_handle || file == fixture_fault_record_handle) &&
      fixture_fault_point == FAULT_CLOSE)
    return FALSE;
  if (fixture_fault_active && file == fixture_fault_root_handle) {
    fixture_fault_release_mask |= 1U;
    if (fixture_fault_point == FAULT_ROOT_CLOSE ||
        fixture_fault_point == FAULT_SIMULTANEOUS)
      return FALSE;
  }
  if (fixture_fault_active && file == fixture_fault_token_handle) {
    fixture_fault_release_mask |= 2U;
    if (fixture_fault_point == FAULT_TOKEN_CLOSE ||
        fixture_fault_point == FAULT_SIMULTANEOUS)
      return FALSE;
  }
  return result;
}

static BOOL WINAPI fixture_FindClose(HANDLE find) {
  BOOL result = FindClose(find);
  if (fixture_fault_active &&
      (fixture_fault_point == FAULT_FIND_CLOSE ||
       fixture_fault_point == FAULT_SIMULTANEOUS)) {
    fixture_fault_release_mask |= 4U;
    return FALSE;
  }
  return result;
}

static BOOL WINAPI fixture_HeapFree(HANDLE heap, DWORD flags, LPVOID value) {
  BOOL result = HeapFree(heap, flags, value);
  if (fixture_fault_active &&
      (fixture_fault_point == FAULT_HEAP_FREE ||
       fixture_fault_point == FAULT_SIMULTANEOUS)) {
    fixture_fault_release_mask |= 8U;
    return FALSE;
  }
  return result;
}

static HANDLE WINAPI fixture_LocalFree(HANDLE value) {
  HANDLE result = LocalFree(value);
  if (fixture_fault_active && value != NULL &&
      (fixture_fault_point == FAULT_LOCAL_FREE ||
       fixture_fault_point == FAULT_SIMULTANEOUS)) {
    fixture_fault_release_mask |= 16U;
    return value;
  }
  return result;
}

static PVOID WINAPI fixture_FreeSid(PSID sid) {
  PVOID result = FreeSid(sid);
  if (fixture_fault_active && sid != NULL &&
      (fixture_fault_point == FAULT_SID_FREE ||
       fixture_fault_point == FAULT_SIMULTANEOUS)) {
    fixture_fault_release_mask |= 32U;
    return sid;
  }
  return result;
}

static NTSTATUS WINAPI fixture_BCryptDestroyHash(BCRYPT_HASH_HANDLE hash) {
  NTSTATUS result = BCryptDestroyHash(hash);
  if (fixture_fault_active &&
      (fixture_fault_point == FAULT_BCRYPT_HASH ||
       fixture_fault_point == FAULT_SIMULTANEOUS)) {
    fixture_fault_release_mask |= 64U;
    return (NTSTATUS)-1;
  }
  return result;
}

static NTSTATUS WINAPI fixture_BCryptCloseAlgorithmProvider(BCRYPT_ALG_HANDLE algorithm,
                                                            DWORD flags) {
  NTSTATUS result = BCryptCloseAlgorithmProvider(algorithm, flags);
  if (fixture_fault_active &&
      (fixture_fault_point == FAULT_BCRYPT_PROVIDER ||
       fixture_fault_point == FAULT_SIMULTANEOUS)) {
    fixture_fault_release_mask |= 128U;
    return (NTSTATUS)-1;
  }
  return result;
}

#endif

static PSID fixture_sid(DWORD first, DWORD second) {
  SID_IDENTIFIER_AUTHORITY authority = SECURITY_NT_AUTHORITY;
  PSID allocated = NULL;
  PSID copied;
  DWORD length;
  if (!AllocateAndInitializeSid(&authority, 2U, first, second, 0U, 0U, 0U, 0U, 0U, 0U,
                                &allocated))
    return NULL;
  length = GetLengthSid(allocated);
  copied = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, length);
  if (copied == NULL || !CopySid(length, copied, allocated)) {
    if (copied != NULL) HeapFree(GetProcessHeap(), 0U, copied);
    FreeSid(allocated);
    return NULL;
  }
  FreeSid(allocated);
  return copied;
}

static PSID fixture_target_sid(const PROFILE_IDENTITY *identity) {
  PSID copied = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, identity->sid_length);
  if (copied != NULL) copy_bytes(copied, identity->sid, identity->sid_length);
  return copied;
}

static PSID fixture_user_sid(int wrong, int malformed) {
  PSID copied;
  DWORD length;
  if (malformed) return HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, 4U);
  if (wrong) return fixture_sid(21U, 1001U);
  length = GetLengthSid(fixture_stable_user);
  copied = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, length);
  if (copied != NULL) copy_bytes(copied, fixture_stable_user, length);
  return copied;
}

static void fixture_set_target_user(INET_FIREWALL_APP_CONTAINER *row) {
  if (fixture_scenario == FIXTURE_TARGET_NULL_USER) return;
  row->userSid = fixture_user_sid(fixture_scenario == FIXTURE_TARGET_WRONG_USER,
                                  fixture_scenario == FIXTURE_TARGET_MALFORMED_USER);
}

static int fixture_set_row(INET_FIREWALL_APP_CONTAINER *row, LPWSTR name, PSID sid) {
  zero_bytes(row, sizeof(*row));
  row->appContainerName = name;
  row->appContainerSid = sid;
  return name != NULL && sid != NULL;
}

DWORD WINAPI fixture_enum_appcontainers(DWORD flags, DWORD *count,
                                        PINET_FIREWALL_APP_CONTAINER *rows) {
  INET_FIREWALL_APP_CONTAINER *result;
  DWORD row_count = 0;
  if (flags != NETISO_FLAG_FORCE_COMPUTE_BINARIES || count == NULL || rows == NULL) return 87U;
  *count = 0U;
  *rows = NULL;
  fixture_expected_rows = 0U;
#if defined(OP_WINDOWS_PROFILE_FIXTURE)
  if (fixture_scenario == FIXTURE_PROFILE_CONTROL && !fixture_profile_present)
    return ERROR_SUCCESS;
#endif
  if (fixture_scenario == FIXTURE_ENUM_ERROR) return 5U;
  if (fixture_scenario == FIXTURE_COMPLETE_EMPTY) return ERROR_SUCCESS;
  if (fixture_scenario == FIXTURE_ENUM_OVERBOUND) row_count = CENSUS_MAXIMUM + 1U;
  else if (fixture_scenario == FIXTURE_TARGET_DUPLICATE ||
           fixture_scenario == FIXTURE_UNRELATED_DUPLICATE ||
           fixture_scenario == FIXTURE_UNRELATED_NAME_CONFLICT ||
           fixture_scenario == FIXTURE_UNRELATED_SID_CONFLICT ||
           fixture_scenario == FIXTURE_MALFORMED_LATE ||
           fixture_scenario == FIXTURE_COMPLETE_DUPLICATE ||
           fixture_scenario == FIXTURE_COMPLETE_GROUP_DUPLICATE ||
           fixture_scenario == FIXTURE_COMPLETE_CROSS_GROUP)
    row_count = 2U;
  else row_count = 1U;
  result = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY,
                     sizeof(INET_FIREWALL_APP_CONTAINER) * row_count);
  if (result == NULL) return 8U;
  fixture_expected_rows = row_count;
  if (fixture_scenario == FIXTURE_PROFILE_CONTROL) {
#if defined(OP_WINDOWS_PROFILE_FIXTURE)
    fixture_set_row(&result[0], fixture_profile_identity.moniker,
                    fixture_profile_sid_copy(&fixture_profile_identity));
    result[0].userSid = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY,
                                  fixture_profile_root->stable_sid_length);
    if (result[0].userSid != NULL)
      copy_bytes(result[0].userSid, fixture_profile_root->stable_sid,
                 fixture_profile_root->stable_sid_length);
    if (fixture_profile_case == 32U) {
      result[0].capabilities.count = 1U;
      result[0].capabilities.capabilities = &fixture_capability;
    }
    if (fixture_profile_case == 33U) {
      if (result[0].userSid != NULL)
        HeapFree(GetProcessHeap(), 0U, result[0].userSid);
      result[0].userSid = fixture_user_sid(1, 0);
    }
#endif
  } else if (fixture_scenario == FIXTURE_ENUM_OVERBOUND) {
    fixture_set_row(&result[0], (LPWSTR)fixture_unrelated_a, fixture_sid(32U, 100U));
  } else if (fixture_scenario == FIXTURE_UNRELATED_DUPLICATE ||
             fixture_scenario == FIXTURE_COMPLETE_DUPLICATE) {
    fixture_set_row(&result[0], (LPWSTR)fixture_unrelated_a, fixture_sid(32U, 100U));
    fixture_set_row(&result[1], (LPWSTR)fixture_unrelated_a, fixture_sid(32U, 100U));
  } else if (fixture_scenario == FIXTURE_UNRELATED_NAME_CONFLICT) {
    fixture_set_row(&result[0], (LPWSTR)fixture_unrelated_a, fixture_sid(32U, 100U));
    fixture_set_row(&result[1], (LPWSTR)fixture_unrelated_a, fixture_sid(32U, 101U));
  } else if (fixture_scenario == FIXTURE_UNRELATED_SID_CONFLICT) {
    fixture_set_row(&result[0], (LPWSTR)fixture_unrelated_a, fixture_sid(32U, 100U));
    fixture_set_row(&result[1], (LPWSTR)fixture_unrelated_b, fixture_sid(32U, 100U));
  } else if (fixture_scenario == FIXTURE_TARGET_NAME_ONLY) {
    fixture_set_row(&result[0], fixture_target.moniker, fixture_sid(32U, 100U));
  } else if (fixture_scenario == FIXTURE_TARGET_SID_ONLY) {
    fixture_set_row(&result[0], (LPWSTR)fixture_unrelated_a,
                    fixture_target_sid(&fixture_target));
  } else if (fixture_scenario == FIXTURE_TARGET_ONE ||
             fixture_scenario == FIXTURE_TARGET_CAPABILITY ||
             fixture_scenario == FIXTURE_TARGET_NULL_USER ||
             fixture_scenario == FIXTURE_TARGET_WRONG_USER ||
             fixture_scenario == FIXTURE_TARGET_MALFORMED_USER ||
             fixture_scenario == FIXTURE_COMPLETE_UNJOURNALED ||
             fixture_scenario == FIXTURE_COMPLETE_TERMINAL) {
    fixture_set_row(&result[0], fixture_target.moniker, fixture_target_sid(&fixture_target));
    fixture_set_target_user(&result[0]);
    if (fixture_scenario == FIXTURE_TARGET_CAPABILITY) {
      result[0].capabilities.count = 1U;
      result[0].capabilities.capabilities = &fixture_capability;
    }
  } else if (fixture_scenario == FIXTURE_TARGET_DUPLICATE ||
             fixture_scenario == FIXTURE_COMPLETE_GROUP_DUPLICATE) {
    fixture_set_row(&result[0], fixture_target.moniker, fixture_target_sid(&fixture_target));
    fixture_set_row(&result[1], fixture_target.moniker, fixture_target_sid(&fixture_target));
    fixture_set_target_user(&result[0]);
    fixture_set_target_user(&result[1]);
  } else if (fixture_scenario == FIXTURE_COMPLETE_CROSS_GROUP) {
    fixture_set_row(&result[0], fixture_target.moniker,
                    fixture_target_sid(&fixture_second_target));
    fixture_set_row(&result[1], fixture_second_target.moniker,
                    fixture_target_sid(&fixture_target));
    fixture_set_target_user(&result[0]);
    fixture_set_target_user(&result[1]);
  } else if (fixture_scenario == FIXTURE_MALFORMED_LATE) {
    fixture_set_row(&result[0], (LPWSTR)fixture_unrelated_a, fixture_sid(32U, 100U));
    fixture_set_row(&result[1], NULL, fixture_sid(32U, 101U));
  } else if (fixture_scenario == FIXTURE_POINTER_MISMATCH) {
    fixture_set_row(&result[0], (LPWSTR)fixture_unrelated_a, fixture_sid(32U, 100U));
    result[0].capabilities.count = 1U;
    result[0].capabilities.capabilities = NULL;
  } else if (fixture_scenario == FIXTURE_FREE_ERROR) {
    fixture_set_row(&result[0], (LPWSTR)fixture_unrelated_a, fixture_sid(32U, 100U));
  } else {
    HeapFree(GetProcessHeap(), 0U, result);
    fixture_expected_rows = 0U;
    return 87U;
  }
  *count = row_count;
  *rows = result;
  return ERROR_SUCCESS;
}

DWORD WINAPI fixture_free_appcontainers(PINET_FIREWALL_APP_CONTAINER rows) {
  DWORD index;
  fixture_free_calls += 1U;
  if (rows == NULL) return 87U;
  for (index = 0; index < fixture_expected_rows; index += 1U)
    if (rows[index].appContainerSid != NULL)
      HeapFree(GetProcessHeap(), 0U, rows[index].appContainerSid);
  for (index = 0; index < fixture_expected_rows; index += 1U)
    if (rows[index].userSid != NULL)
      HeapFree(GetProcessHeap(), 0U, rows[index].userSid);
  HeapFree(GetProcessHeap(), 0U, rows);
  return fixture_scenario == FIXTURE_FREE_ERROR ? 5U : ERROR_SUCCESS;
}

static DWORD fixture_scenario_value(const WCHAR *value) {
  static const WCHAR *names[] = {
    L"", L"enum-error", L"overbound", L"unrelated-duplicate", L"unrelated-name-conflict",
    L"unrelated-sid-conflict", L"target-one", L"target-duplicate", L"target-name-only",
    L"target-sid-only", L"target-capability", L"malformed-late", L"free-error",
    L"complete-empty", L"complete-duplicate", L"complete-unjournaled", L"complete-terminal",
    L"complete-group-duplicate", L"complete-cross-group", L"pointer-mismatch",
    L"record-folder-arms", L"target-null-user", L"target-wrong-user",
    L"target-malformed-user", L"lifecycle-clean", L"lifecycle-cleanup-failure",
    L"lifecycle-root-close-failure", L"durable-publication", L"fault-publication",
    L"fault-resources", L"profile-control", L"mixed-recovery", L"substitution"
  };
  DWORD index;
  for (index = 1U; index < sizeof(names) / sizeof(names[0]); index += 1U)
    if (wide_equal(value, names[index])) return index;
  return 0U;
}

static int fixture_expected_result(void) {
  JOURNAL_GROUP groups[2];
  ROOT_CUSTODY root;
  int result;
  zero_bytes(groups, sizeof(groups));
  zero_bytes(&root, sizeof(root));
  root.stable_sid = fixture_stable_user;
  root.stable_sid_length = GetLengthSid(fixture_stable_user);
  fixture_free_calls = 0U;
#if defined(OP_WINDOWS_PROFILE_FIXTURE)
  if (fixture_scenario == FIXTURE_SUBSTITUTION) {
    BYTE variant;
    BROKER_FRAME frame;
    WCHAR path[PATH_MAX_UNITS + 1U];
    WORD path_units = 0U;
    WCHAR source[1200];
    WCHAR moved[1200];
    DWORD cursor = 0U;
    PROFILE_IDENTITY identity;
    HANDLE mutation = INVALID_HANDLE_VALUE;
    int valid = 0;
    if (!read_exact(GetStdHandle(STD_INPUT_HANDLE), &variant, 1U) || variant < 1U || variant > 3U ||
        read_frame(GetStdHandle(STD_INPUT_HANDLE), &frame, 1) != 1 ||
        !canonical_scope_path(frame.payload, frame.length, path, &path_units))
      return 0;
    zero_bytes(&root, sizeof(root));
    if (!retain_root(path, path_units, &root)) goto substitution_done;
    if (variant == 1U) {
      mutation = CreateFileW(path, DELETE | FILE_READ_ATTRIBUTES,
                             FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                             NULL, OPEN_EXISTING,
                             FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
      if (mutation == INVALID_HANDLE_VALUE ||
          !append_wide(moved, 1200U, &cursor, path) ||
          !append_wide(moved, 1200U, &cursor, L"-moved") ||
          !fixture_rename_handle(mutation, moved) || !CloseHandle(mutation))
        goto substitution_done;
      mutation = INVALID_HANDLE_VALUE;
      if (!CreateDirectoryW(path, NULL) || root_snapshot(&root, 0) != 0 ||
          GetFileAttributesW(path) == INVALID_FILE_ATTRIBUTES ||
          GetFileAttributesW(moved) == INVALID_FILE_ATTRIBUTES)
        goto substitution_done;
    } else {
      BYTE replacement = 0x5aU;
      DWORD written = 0U;
      if (!identity_for_token(&root, (BYTE[32]){10U}, &identity)) goto substitution_done;
      if (variant == 2U) {
        if (!persist_phase(&root, &identity, JOURNAL_USED) ||
            !journal_path(&root, identity.token, JOURNAL_USED, 0, source))
          goto substitution_done;
      } else {
        BYTE record[4096];
        DWORD length = journal_record(&root, &identity, JOURNAL_USED, record, sizeof(record));
        PSECURITY_DESCRIPTOR security = NULL;
        SECURITY_ATTRIBUTES attributes;
        if (length == 0U || !journal_path(&root, identity.token, JOURNAL_USED, 1, source) ||
            !file_security(&root, &security))
          goto substitution_done;
        attributes.nLength = sizeof(attributes);
        attributes.lpSecurityDescriptor = security;
        attributes.bInheritHandle = FALSE;
        mutation = CreateFileW(source, GENERIC_READ | GENERIC_WRITE, 0U, &attributes,
                               CREATE_NEW, FILE_ATTRIBUTE_NORMAL, NULL);
        if (LocalFree(security) != NULL || mutation == INVALID_HANDLE_VALUE ||
            !WriteFile(mutation, record, length, &written, NULL) || written != length ||
            !FlushFileBuffers(mutation) || !CloseHandle(mutation))
          goto substitution_done;
        mutation = INVALID_HANDLE_VALUE;
      }
      cursor = 0U;
      if (!append_wide(moved, 1200U, &cursor, path) ||
          !append_wide(moved, 1200U, &cursor,
                       variant == 2U ? L"-final-moved.opwj" : L"-pending-moved.opwj"))
        goto substitution_done;
      mutation = CreateFileW(source, DELETE | GENERIC_READ,
                             FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                             NULL, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, NULL);
      if (mutation == INVALID_HANDLE_VALUE || !fixture_rename_handle(mutation, moved) ||
          !CloseHandle(mutation))
        goto substitution_done;
      mutation = INVALID_HANDLE_VALUE;
      mutation = CreateFileW(source, GENERIC_WRITE, 0U, NULL, CREATE_NEW,
                             FILE_ATTRIBUTE_NORMAL, NULL);
      written = 0U;
      if (mutation == INVALID_HANDLE_VALUE ||
          !WriteFile(mutation, &replacement, 1U, &written, NULL) || written != 1U ||
          !CloseHandle(mutation))
        goto substitution_done;
      mutation = INVALID_HANDLE_VALUE;
      {
        JOURNAL_GROUP *groups = NULL;
        DWORD count = 0U;
        if (scan_journals(&root, &groups, &count) != -1) {
          if (groups != NULL) HeapFree(GetProcessHeap(), 0U, groups);
          goto substitution_done;
        }
      }
      if (GetFileAttributesW(source) == INVALID_FILE_ATTRIBUTES ||
          GetFileAttributesW(moved) == INVALID_FILE_ATTRIBUTES)
        goto substitution_done;
    }
    valid = 1;
substitution_done:
    if (mutation != INVALID_HANDLE_VALUE && !CloseHandle(mutation)) valid = 0;
    if (!release_root(&root)) {
      if (variant != 1U) valid = 0;
    }
    return valid;
  }
  if (fixture_scenario == FIXTURE_MIXED_RECOVERY) {
    BYTE variant;
    BROKER_FRAME frame;
    WCHAR path[PATH_MAX_UNITS + 1U];
    WORD path_units = 0U;
    PROFILE_IDENTITY first;
    PROFILE_IDENTITY second;
    WCHAR record_path[1200];
    HANDLE held = INVALID_HANDLE_VALUE;
    int result;
    int valid = 0;
    if (!read_exact(GetStdHandle(STD_INPUT_HANDLE), &variant, 1U) || variant < 1U || variant > 5U ||
        read_frame(GetStdHandle(STD_INPUT_HANDLE), &frame, 1) != 1 ||
        !canonical_scope_path(frame.payload, frame.length, path, &path_units))
      return 0;
    zero_bytes(&root, sizeof(root));
    zero_bytes(&fixture_profile_identity, sizeof(fixture_profile_identity));
    fixture_profile_present = 0;
    fixture_profile_folder_present = 0;
    fixture_profile_create_calls = 0;
    fixture_profile_delete_calls = 0;
    fixture_profile_case = 1U;
    if (!retain_root(path, path_units, &root)) goto mixed_done;
    fixture_profile_root = &root;
    if (!identity_for_token(&root, (BYTE[32]){8U}, &first) ||
        !persist_phase(&root, &first, JOURNAL_USED) ||
        !persist_phase(&root, &first, JOURNAL_PROFILE_ATTEMPTED) ||
        !identity_for_token(&root, (BYTE[32]){9U}, &second) ||
        (variant != 5U && !persist_phase(&root, &second, JOURNAL_USED)))
      goto mixed_done;
    if (variant == 1U) {
      BYTE changed = 1U;
      DWORD written = 0U;
      if (!journal_path(&root, second.token, JOURNAL_USED, 0, record_path)) goto mixed_done;
      held = CreateFileW(record_path, GENERIC_READ | GENERIC_WRITE, 0U, NULL, OPEN_EXISTING,
                         FILE_FLAG_OPEN_REPARSE_POINT, NULL);
      if (held == INVALID_HANDLE_VALUE || SetFilePointer(held, 44, NULL, FILE_BEGIN) != 44U ||
          !WriteFile(held, &changed, 1U, &written, NULL) || written != 1U ||
          !FlushFileBuffers(held) || !CloseHandle(held))
        goto mixed_done;
      held = INVALID_HANDLE_VALUE;
    } else if (variant == 2U) {
      static const WCHAR folder[] = L"\\\\?\\C:\\fixture-profile";
      second.folder_units = (WORD)wide_length(folder);
      copy_bytes(second.folder, folder, ((DWORD)second.folder_units + 1U) * 2U);
      second.folder_binding[0] = 1U;
      if (!persist_phase(&root, &second, JOURNAL_PROFILE_CREATED)) goto mixed_done;
    } else if (variant == 3U) {
      DWORD cursor = 0U;
      if (!append_wide(record_path, 1200U, &cursor, root.path) ||
          !append_wide(record_path, 1200U, &cursor, L"\\unknown-state"))
        goto mixed_done;
      held = CreateFileW(record_path, GENERIC_WRITE, 0U, NULL, CREATE_NEW,
                         FILE_ATTRIBUTE_NORMAL, NULL);
      if (held == INVALID_HANDLE_VALUE || !CloseHandle(held)) goto mixed_done;
      held = INVALID_HANDLE_VALUE;
    } else if (variant == 4U) {
      if (!journal_path(&root, second.token, JOURNAL_USED, 0, record_path)) goto mixed_done;
      held = CreateFileW(record_path, GENERIC_READ, 0U, NULL, OPEN_EXISTING,
                         FILE_FLAG_OPEN_REPARSE_POINT, NULL);
      if (held == INVALID_HANDLE_VALUE) goto mixed_done;
    } else {
      BYTE record[4096];
      DWORD length = journal_record(&root, &second, JOURNAL_PROFILE_ATTEMPTED,
                                    record, sizeof(record));
      DWORD written = 0U;
      PSECURITY_DESCRIPTOR security = NULL;
      SECURITY_ATTRIBUTES attributes;
      if (length == 0U || !journal_path(&root, second.token, JOURNAL_PROFILE_ATTEMPTED,
                                        1, record_path) || !file_security(&root, &security))
        goto mixed_done;
      attributes.nLength = sizeof(attributes);
      attributes.lpSecurityDescriptor = security;
      attributes.bInheritHandle = FALSE;
      held = CreateFileW(record_path, GENERIC_READ | GENERIC_WRITE, 0U, &attributes,
                         CREATE_NEW, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH, NULL);
      if (LocalFree(security) != NULL || held == INVALID_HANDLE_VALUE ||
          !WriteFile(held, record, length, &written, NULL) || written != length ||
          !FlushFileBuffers(held) || !CloseHandle(held) || !FlushFileBuffers(root.handle))
        goto mixed_done;
      held = INVALID_HANDLE_VALUE;
    }
    result = preflight_and_recover(&root);
    if (result != -1 || fixture_profile_create_calls != 0 || fixture_profile_delete_calls != 0)
      goto mixed_done;
    valid = 1;
mixed_done:
    if (held != INVALID_HANDLE_VALUE && !CloseHandle(held)) valid = 0;
    if (!release_root(&root)) valid = 0;
    fixture_profile_root = NULL;
    return valid;
  }
  if (fixture_scenario == FIXTURE_PROFILE_CONTROL) {
    BYTE configuration[2];
    BROKER_FRAME frame;
    WCHAR path[PATH_MAX_UNITS + 1U];
    WORD path_units = 0U;
    PROFILE_IDENTITY identity;
    HANDLE folder_handle = NULL;
    int operation_result;
    int valid = 0;
    BYTE profile_stage = 1U;
    if (!read_exact(GetStdHandle(STD_INPUT_HANDLE), configuration, sizeof(configuration)) ||
        configuration[0] < 1U || configuration[0] > 39U || configuration[1] > 2U ||
        read_frame(GetStdHandle(STD_INPUT_HANDLE), &frame, 1) != 1 ||
        frame.operation != PREPARE_OPERATION ||
        !canonical_scope_path(frame.payload, frame.length, path, &path_units))
      return 0;
    fixture_profile_case = configuration[0];
    fixture_profile_present = 0;
    fixture_profile_folder_present = 0;
    fixture_profile_create_calls = 0;
    fixture_profile_delete_calls = 0;
    fixture_profile_close_calls = 0;
    fixture_profile_security_calls = 0;
    fixture_profile_file_info_calls = 0;
    fixture_profile_created_journal = NULL;
    fixture_profile_forbidden_free_armed = 0;
    fixture_profile_forbidden_free_fired = 0;
    zero_bytes(&fixture_profile_identity, sizeof(fixture_profile_identity));
    zero_bytes(&root, sizeof(root));
    if (!retain_root(path, path_units, &root)) goto profile_done;
    fixture_profile_root = &root;
    profile_stage = 2U;
    if (configuration[1] == 0U) {
      operation_result = create_profile(&root, &identity, &folder_handle);
      profile_stage = 3U;
      if (fixture_profile_case == 1U || fixture_profile_case == 14U ||
          fixture_profile_case == 27U ||
          (fixture_profile_case >= 28U && fixture_profile_case <= 31U)) {
        int cleanup_result;
        if (operation_result != 1) {
          profile_stage = fixture_profile_security_calls == 0 ? 5U : 6U;
          goto profile_done;
        }
        if ((configuration[0] == 14U || configuration[0] == 27U) &&
            folder_handle != NULL) {
          if (!fixture_profile_CloseHandle(folder_handle)) goto profile_done;
          folder_handle = NULL;
        }
        cleanup_result = cleanup_profile(&root, &identity, &folder_handle);
        if (configuration[0] == 30U || configuration[0] == 31U) {
          if (cleanup_result != 0) goto profile_done;
          if (identity.phase != JOURNAL_PROFILE_DELETE_ATTEMPTED ||
              fixture_profile_delete_calls != 1 ||
              !cleanup_profile(&root, &identity, &folder_handle) ||
              identity.phase != JOURNAL_PROFILE_ABSENCE_PROVED ||
              fixture_profile_delete_calls != 2)
            goto profile_done;
        } else if (configuration[0] == 14U || configuration[0] == 27U) {
          if (cleanup_result != 0) goto profile_done;
          fixture_profile_case = 1U;
          if (!cleanup_profile(&root, &identity, &folder_handle)) goto profile_done;
        } else if (!cleanup_result) {
          goto profile_done;
        }
      } else {
        int expected_result =
          (configuration[0] == 5U || configuration[0] == 6U ||
           configuration[0] == 7U || configuration[0] == 39U) ? 0 : -1;
        if (operation_result != expected_result) goto profile_done;
        fixture_profile_case = 1U;
        if (identity.phase >= JOURNAL_PROFILE_ATTEMPTED &&
            identity.phase < JOURNAL_PROFILE_ABSENCE_PROVED &&
            !cleanup_profile(&root, &identity, &folder_handle))
          goto profile_done;
      }
    } else {
      if (!identity_for_token(&root, (BYTE[32]){7U}, &identity) ||
          !persist_phase(&root, &identity, JOURNAL_USED) ||
          !persist_phase(&root, &identity, JOURNAL_PROFILE_ATTEMPTED))
        goto profile_done;
      copy_bytes(&fixture_profile_identity, &identity, sizeof(identity));
      if (configuration[1] == 2U) {
        fixture_profile_present = 1;
        fixture_profile_folder_present = 1;
      }
      operation_result = reconcile_attempted_profile(&root, &identity, &folder_handle);
      {
        int success_expected = fixture_profile_case == 1U || fixture_profile_case == 14U ||
                               fixture_profile_case == 27U ||
                               (fixture_profile_case >= 28U && fixture_profile_case <= 31U);
        if (operation_result != success_expected) goto profile_done;
        if (!success_expected) {
          reset_uncommitted_folder(&root, &identity, &folder_handle);
          fixture_profile_case = 1U;
          if (!reconcile_attempted_profile(&root, &identity, &folder_handle) ||
              !cleanup_profile(&root, &identity, &folder_handle))
            goto profile_done;
        } else {
          int cleanup_result;
          if ((configuration[0] == 14U || configuration[0] == 27U) &&
              folder_handle != NULL) {
            if (!fixture_profile_CloseHandle(folder_handle)) goto profile_done;
            folder_handle = NULL;
          }
          cleanup_result = cleanup_profile(&root, &identity, &folder_handle);
          if (configuration[0] == 30U || configuration[0] == 31U) {
            if (cleanup_result != 0 || identity.phase != JOURNAL_PROFILE_DELETE_ATTEMPTED ||
                fixture_profile_delete_calls != 1 ||
                !cleanup_profile(&root, &identity, &folder_handle) ||
                identity.phase != JOURNAL_PROFILE_ABSENCE_PROVED ||
                fixture_profile_delete_calls != 2)
              goto profile_done;
          } else if (configuration[0] == 14U || configuration[0] == 27U) {
            if (cleanup_result != 0) goto profile_done;
            fixture_profile_case = 1U;
            if (!cleanup_profile(&root, &identity, &folder_handle)) goto profile_done;
          } else if (!cleanup_result) {
            goto profile_done;
          }
        }
      }
    }
    profile_stage = 4U;
    {
      int direct_success = configuration[0] == 1U || configuration[0] == 14U ||
                           configuration[0] == 27U ||
                           (configuration[0] >= 28U && configuration[0] <= 31U);
      int expected_create_calls;
      int expected_delete_calls =
        (configuration[0] == 30U || configuration[0] == 31U) ? 2 : 1;
      int expected_resource_ambiguity =
        configuration[0] == 28U || configuration[0] == 39U;
      if (configuration[1] == 0U) {
        expected_create_calls = direct_success ? 1 :
          (configuration[0] == 4U || configuration[0] == 8U ? 3 : 2);
      } else {
        expected_create_calls = direct_success ||
          (configuration[1] == 2U &&
           (configuration[0] == 32U || configuration[0] == 33U)) ? 1 : 2;
      }
      if (identity.phase != JOURNAL_PROFILE_ABSENCE_PROVED ||
          fixture_profile_create_calls != expected_create_calls ||
          fixture_profile_delete_calls != expected_delete_calls ||
          !!root.resource_ambiguous != expected_resource_ambiguity ||
          fixture_profile_forbidden_free_fired != (configuration[0] == 39U))
        goto profile_done;
    }
    if (fixture_profile_present || fixture_profile_folder_present || folder_handle != NULL)
      goto profile_done;
    valid = 1;
profile_done:
    if (!release_root(&root)) {
      if (configuration[0] != 28U && configuration[0] != 39U) valid = 0;
    }
    if (!valid) {
      static const CHAR *messages[] = {
        "", "fixture:profile-stage-1\n", "fixture:profile-stage-2\n",
        "fixture:profile-stage-3\n", "fixture:profile-stage-4\n",
        "fixture:profile-before-security\n", "fixture:profile-after-security\n"
      };
      diagnostic(messages[profile_stage]);
    }
    fixture_profile_root = NULL;
    return valid;
  }
#endif
#if defined(OP_WINDOWS_FAULT_FIXTURE)
  if (fixture_scenario == FIXTURE_FAULT_RESOURCES) {
    BYTE resource_point;
    BROKER_FRAME frame;
    WCHAR path[PATH_MAX_UNITS + 1U];
    WORD path_units = 0U;
    PROFILE_IDENTITY identity;
    JOURNAL_GROUP *observed = NULL;
    DWORD observed_count = 0U;
    static const WCHAR folder[] = L"\\\\?\\C:\\fixture-profile";
    static const DWORD masks[] = {4U, 1U, 2U, 8U, 16U, 32U, 64U, 128U, 11U};
    DWORD expected_mask;
    int valid = 0;
    BYTE resource_stage = 1U;
    if (!read_exact(GetStdHandle(STD_INPUT_HANDLE), &resource_point, 1U) ||
        resource_point < FAULT_FIND_CLOSE || resource_point > FAULT_SIMULTANEOUS ||
        read_frame(GetStdHandle(STD_INPUT_HANDLE), &frame, 1) != 1 ||
        frame.operation != PREPARE_OPERATION ||
        !canonical_scope_path(frame.payload, frame.length, path, &path_units))
      return 0;
    zero_bytes(&root, sizeof(root));
    if (!retain_root(path, path_units, &root) ||
        !identity_for_token(&root, (BYTE[32]){6U}, &identity) ||
        !persist_phase(&root, &identity, JOURNAL_USED) ||
        !persist_phase(&root, &identity, JOURNAL_PROFILE_ATTEMPTED))
      goto resource_done;
    identity.folder_units = (WORD)wide_length(folder);
    copy_bytes(identity.folder, folder, ((DWORD)identity.folder_units + 1U) * 2U);
    identity.folder_binding[0] = 1U;
    if (!persist_phase(&root, &identity, JOURNAL_PROFILE_CREATED) ||
        !persist_phase(&root, &identity, JOURNAL_PROFILE_DELETE_ATTEMPTED) ||
        !persist_phase(&root, &identity, JOURNAL_PROFILE_ABSENCE_PROVED))
      goto resource_done;
    resource_stage = 2U;
    fixture_fault_point = resource_point;
    fixture_fault_root_handle = root.handle;
    fixture_fault_token_handle = root.token;
    fixture_fault_release_mask = 0U;
    fixture_fault_active = 1U;
    if (resource_point == FAULT_SID_FREE &&
        (!forbidden_profile_sid(identity.sid, &root) || !root.resource_ambiguous))
      goto resource_done;
    (void)scan_journals(&root, &observed, &observed_count);
    resource_stage = 3U;
    if (release_root(&root) != 0) goto resource_done;
    resource_stage = 4U;
    fixture_fault_active = 0U;
    expected_mask = masks[resource_point - FAULT_FIND_CLOSE];
    if ((fixture_fault_release_mask & expected_mask) != expected_mask) goto resource_done;
    resource_stage = 5U;
    if (observed != NULL) {
      if (!HeapFree(GetProcessHeap(), 0U, observed)) goto resource_done;
      observed = NULL;
    }
    if (!retain_root(path, path_units, &root) ||
        scan_journals(&root, &observed, &observed_count) != 1 || observed_count != 1U ||
        observed[0].identity.phase != JOURNAL_PROFILE_ABSENCE_PROVED)
      goto resource_done;
    resource_stage = 6U;
    valid = 1;
resource_done:
    fixture_fault_active = 0U;
    if (observed != NULL && !HeapFree(GetProcessHeap(), 0U, observed)) valid = 0;
    if (root.handle != NULL && !release_root(&root)) valid = 0;
    if (!valid) {
      static const CHAR *messages[] = {
        "", "fixture:resource-stage-1\n", "fixture:resource-stage-2\n",
        "fixture:resource-stage-3\n", "fixture:resource-stage-4\n",
        "fixture:resource-stage-5\n", "fixture:resource-stage-6\n"
      };
      diagnostic(messages[resource_stage]);
    }
    return valid;
  }
  if (fixture_scenario == FIXTURE_FAULT_PUBLICATION) {
    BYTE configuration[2];
    BROKER_FRAME frame;
    WCHAR path[PATH_MAX_UNITS + 1U];
    WORD path_units = 0U;
    PROFILE_IDENTITY identity;
    JOURNAL_GROUP *observed = NULL;
    DWORD observed_count = 0U;
    static const WCHAR folder[] = L"\\\\?\\C:\\fixture-profile";
    int valid = 0;
    BYTE stage = 1U;
    if (!read_exact(GetStdHandle(STD_INPUT_HANDLE), configuration, sizeof(configuration)) ||
        configuration[0] < JOURNAL_USED ||
        configuration[0] > JOURNAL_PROFILE_ABSENCE_PROVED ||
        configuration[1] < FAULT_PENDING_CREATE || configuration[1] > FAULT_PRIOR_PARSE ||
        read_frame(GetStdHandle(STD_INPUT_HANDLE), &frame, 1) != 1 ||
        frame.operation != PREPARE_OPERATION ||
        !canonical_scope_path(frame.payload, frame.length, path, &path_units))
      return 0;
    fixture_fault_phase = configuration[0];
    fixture_fault_point = configuration[1];
    zero_bytes(&root, sizeof(root));
    if (!retain_root(path, path_units, &root) ||
        !identity_for_token(&root, (BYTE[32]){5U}, &identity))
      goto fault_done;
    stage = 2U;
    fixture_fault_root_handle = root.handle;
    fixture_fault_token_handle = root.token;
    for (BYTE kind = JOURNAL_USED; kind < fixture_fault_phase; kind += 1U) {
      if (kind == JOURNAL_PROFILE_CREATED) {
        identity.folder_units = (WORD)wide_length(folder);
        copy_bytes(identity.folder, folder, ((DWORD)identity.folder_units + 1U) * 2U);
        identity.folder_binding[0] = 1U;
      }
      if (!persist_phase(&root, &identity, kind)) goto fault_done;
    }
    if (fixture_fault_phase == JOURNAL_PROFILE_CREATED && identity.folder_units == 0U) {
      identity.folder_units = (WORD)wide_length(folder);
      copy_bytes(identity.folder, folder, ((DWORD)identity.folder_units + 1U) * 2U);
      identity.folder_binding[0] = 1U;
    }
    fixture_fault_active = 1U;
    stage = 3U;
    if (fixture_fault_point == FAULT_PRIOR_PARSE) {
      for (BYTE kind = fixture_fault_phase; kind <= JOURNAL_PROFILE_ABSENCE_PROVED; kind += 1U) {
        if (kind == JOURNAL_PROFILE_CREATED && identity.folder_units == 0U) {
          identity.folder_units = (WORD)wide_length(folder);
          copy_bytes(identity.folder, folder, ((DWORD)identity.folder_units + 1U) * 2U);
          identity.folder_binding[0] = 1U;
        }
        fixture_fault_active = 0U;
        if (!persist_phase(&root, &identity, kind)) goto fault_done;
      }
      fixture_fault_active = 1U;
      if (scan_journals(&root, &observed, &observed_count) != -1) goto fault_done;
      fixture_fault_active = 0U;
    } else {
      if (persist_phase(&root, &identity, fixture_fault_phase) != 0) goto fault_done;
      fixture_fault_active = 0U;
    }
    if (observed != NULL) {
      if (!HeapFree(GetProcessHeap(), 0U, observed)) goto fault_done;
      observed = NULL;
    }
    (void)release_root(&root);
    if (!retain_root(path, path_units, &root)) goto fault_done;
    fixture_fault_root_handle = root.handle;
    fixture_fault_token_handle = root.token;
    stage = 4U;
    if (scan_journals(&root, &observed, &observed_count) != 1 || observed_count > 1U)
      goto fault_done;
    stage = 5U;
    if (observed_count == 1U) {
      copy_bytes(&identity, &observed[0].identity, sizeof(identity));
      if (!clear_pending(&root, &identity)) goto fault_done;
    }
    if (observed != NULL) {
      if (!HeapFree(GetProcessHeap(), 0U, observed)) goto fault_done;
      observed = NULL;
    }
    stage = 6U;
    for (BYTE kind = (BYTE)(identity.phase + 1U);
         kind <= JOURNAL_PROFILE_ABSENCE_PROVED; kind += 1U) {
      if (kind == JOURNAL_PROFILE_CREATED && identity.folder_units == 0U) {
        identity.folder_units = (WORD)wide_length(folder);
        copy_bytes(identity.folder, folder, ((DWORD)identity.folder_units + 1U) * 2U);
        identity.folder_binding[0] = 1U;
      }
      if (!persist_phase(&root, &identity, kind)) goto fault_done;
    }
    if (scan_journals(&root, &observed, &observed_count) != 1 || observed_count != 1U ||
        observed[0].identity.phase != JOURNAL_PROFILE_ABSENCE_PROVED)
      goto fault_done;
    stage = 7U;
    valid = 1;
fault_done:
    fixture_fault_active = 0U;
    if (observed != NULL && !HeapFree(GetProcessHeap(), 0U, observed)) valid = 0;
    if (!release_root(&root)) valid = 0;
    if (!valid) {
      static const CHAR *messages[] = {
        "", "fixture:fault-stage-1\n", "fixture:fault-stage-2\n",
        "fixture:fault-stage-3\n", "fixture:fault-stage-4\n",
        "fixture:fault-stage-5\n", "fixture:fault-stage-6\n",
        "fixture:fault-stage-7\n"
      };
      diagnostic(messages[stage]);
    }
    return valid;
  }
#endif
  if (fixture_scenario == FIXTURE_DURABLE_PUBLICATION) {
    BROKER_FRAME frame;
    WCHAR path[PATH_MAX_UNITS + 1U];
    WORD path_units = 0U;
    PROFILE_IDENTITY identity;
    JOURNAL_GROUP *observed = NULL;
    DWORD observed_count = 0U;
    static const WCHAR folder[] = L"\\\\?\\C:\\fixture-profile";
    int valid = 0;
    if (read_frame(GetStdHandle(STD_INPUT_HANDLE), &frame, 1) != 1 ||
        frame.operation != PREPARE_OPERATION ||
        !canonical_scope_path(frame.payload, frame.length, path, &path_units))
      return 0;
    zero_bytes(&root, sizeof(root));
    if (!retain_root(path, path_units, &root) ||
        !identity_for_token(&root, (BYTE[32]){4U}, &identity) ||
        !persist_phase(&root, &identity, JOURNAL_USED) ||
        !persist_phase(&root, &identity, JOURNAL_PROFILE_ATTEMPTED))
      goto durable_done;
    identity.folder_units = (WORD)wide_length(folder);
    copy_bytes(identity.folder, folder, ((DWORD)identity.folder_units + 1U) * 2U);
    identity.folder_binding[0] = 1U;
    if (!persist_phase(&root, &identity, JOURNAL_PROFILE_CREATED) ||
        !persist_phase(&root, &identity, JOURNAL_PROFILE_DELETE_ATTEMPTED) ||
        !persist_phase(&root, &identity, JOURNAL_PROFILE_ABSENCE_PROVED) ||
        scan_journals(&root, &observed, &observed_count) != 1 || observed_count != 1U ||
        observed[0].identity.phase != JOURNAL_PROFILE_ABSENCE_PROVED)
      goto durable_done;
    valid = 1;
durable_done:
    if (observed != NULL && !HeapFree(GetProcessHeap(), 0U, observed)) valid = 0;
    if (!release_root(&root)) valid = 0;
    return valid;
  }
  if (!identity_for_token(&root, (BYTE[32]){1U}, &fixture_target) ||
      !identity_for_token(&root, (BYTE[32]){2U}, &fixture_second_target))
    return 0;
  if (fixture_scenario == FIXTURE_RECORD_FOLDER_ARMS) {
    ROOT_CUSTODY root;
    BYTE record[4096];
    DWORD used_length;
    DWORD attempted_length;
    DWORD created_length;
    static const WCHAR folder[] = L"\\\\?\\C:\\fixture-profile";
    zero_bytes(&root, sizeof(root));
    if (fixture_target.folder_units != 0U || fixture_target.folder[0] != L'\0') return 0;
    used_length = journal_record(&root, &fixture_target, JOURNAL_USED, record, sizeof(record));
    attempted_length = journal_record(&root, &fixture_target, JOURNAL_PROFILE_ATTEMPTED,
                                      record, sizeof(record));
    if (used_length == 0U || attempted_length == 0U ||
        journal_record(&root, &fixture_target, JOURNAL_PROFILE_CREATED,
                       record, sizeof(record)) != 0U)
      return 0;
    fixture_target.folder_units = (WORD)wide_length(folder);
    copy_bytes(fixture_target.folder, folder,
               ((DWORD)fixture_target.folder_units + 1U) * sizeof(WCHAR));
    fixture_target.folder_binding[0] = 1U;
    if (journal_record(&root, &fixture_target, JOURNAL_USED, record, sizeof(record)) != 0U ||
        journal_record(&root, &fixture_target, JOURNAL_PROFILE_ATTEMPTED,
                       record, sizeof(record)) != 0U)
      return 0;
    created_length = journal_record(&root, &fixture_target, JOURNAL_PROFILE_CREATED,
                                    record, sizeof(record));
    return created_length != 0U && record[5] == JOURNAL_PROFILE_CREATED &&
           read_u32(record + 8U) == created_length &&
           record[created_length - 32U] == 1U;
  }
  if (fixture_scenario >= FIXTURE_COMPLETE_EMPTY &&
      fixture_scenario <= FIXTURE_COMPLETE_CROSS_GROUP) {
    DWORD group_count = 0U;
    if (fixture_scenario == FIXTURE_COMPLETE_TERMINAL ||
        fixture_scenario == FIXTURE_COMPLETE_GROUP_DUPLICATE) {
      copy_bytes(&groups[0].identity, &fixture_target, sizeof(fixture_target));
      groups[0].identity.phase = fixture_scenario == FIXTURE_COMPLETE_TERMINAL ?
                                   JOURNAL_PROFILE_ABSENCE_PROVED : JOURNAL_PROFILE_CREATED;
      group_count = 1U;
    } else if (fixture_scenario == FIXTURE_COMPLETE_CROSS_GROUP) {
      copy_bytes(&groups[0].identity, &fixture_target, sizeof(fixture_target));
      groups[0].identity.phase = JOURNAL_PROFILE_CREATED;
      copy_bytes(&groups[1].identity, &fixture_second_target, sizeof(fixture_second_target));
      groups[1].identity.phase = JOURNAL_PROFILE_CREATED;
      group_count = 2U;
    }
    result = complete_profile_census(&root, groups, group_count);
    if (fixture_scenario == FIXTURE_COMPLETE_EMPTY || fixture_scenario == FIXTURE_COMPLETE_DUPLICATE)
      return result == 1 && fixture_free_calls == (fixture_scenario == FIXTURE_COMPLETE_EMPTY ? 0U : 1U);
    return result == -1 && fixture_free_calls == 1U;
  }
  if (fixture_scenario == FIXTURE_TARGET_ONE)
    result = census_profile(&root, &fixture_target, 0, 1);
  else if (fixture_scenario == FIXTURE_UNRELATED_DUPLICATE)
    result = census_profile(&root, &fixture_target, 1, 0);
  else
    result = census_profile(&root, &fixture_target, 0, 1);
  if (fixture_scenario == FIXTURE_ENUM_ERROR) return result == 0 && fixture_free_calls == 0U;
  return result == (fixture_scenario == FIXTURE_TARGET_ONE ||
                    fixture_scenario == FIXTURE_UNRELATED_DUPLICATE) && fixture_free_calls == 1U;
}

#if defined(OP_WINDOWS_LIFECYCLE_FIXTURE)

static int fixture_retain_root(const WCHAR *path, WORD path_units, ROOT_CUSTODY *root) {
  zero_bytes(root, sizeof(*root));
  root->handle = (HANDLE)1U;
  root->path_units = path_units;
  copy_bytes(root->path, path, ((DWORD)path_units + 1U) * 2U);
  diagnostic("fixture:retain-root\n");
  return 1;
}

static int fixture_preflight_and_recover(ROOT_CUSTODY *root) {
  (void)root;
  diagnostic("fixture:preflight\n");
  return 1;
}

static int fixture_create_profile(ROOT_CUSTODY *root, PROFILE_IDENTITY *identity,
                                  HANDLE *folder_handle) {
  static const WCHAR folder[] = L"\\\\?\\C:\\fixture-profile";
  if (!identity_for_token(root, (BYTE[32]){3U}, identity)) return -1;
  identity->folder_units = (WORD)wide_length(folder);
  copy_bytes(identity->folder, folder, ((DWORD)identity->folder_units + 1U) * 2U);
  identity->phase = JOURNAL_PROFILE_CREATED;
  *folder_handle = (HANDLE)2U;
  diagnostic("fixture:create-profile\n");
  return 1;
}

static int fixture_cleanup_profile(ROOT_CUSTODY *root, PROFILE_IDENTITY *identity,
                                   HANDLE *folder_handle) {
  (void)root;
  identity->phase = JOURNAL_PROFILE_ABSENCE_PROVED;
  *folder_handle = NULL;
  diagnostic("fixture:cleanup-profile\n");
  return fixture_scenario != FIXTURE_LIFECYCLE_CLEANUP_FAILURE;
}

static int fixture_release_root(ROOT_CUSTODY *root) {
  zero_bytes(root, sizeof(*root));
  diagnostic("fixture:release-root\n");
  return fixture_scenario != FIXTURE_LIFECYCLE_ROOT_CLOSE_FAILURE;
}

#endif

__declspec(noreturn) void fixture_entry(void) {
  WCHAR *scenario_text = NULL;
  if (!parse_mode(GetCommandLineW(), &scenario_text)) ExitProcess(64U);
  fixture_scenario = fixture_scenario_value(scenario_text);
  fixture_stable_user = fixture_sid(21U, 1000U);
  if (fixture_scenario >= FIXTURE_LIFECYCLE_CLEAN &&
      fixture_scenario <= FIXTURE_LIFECYCLE_ROOT_CLOSE_FAILURE)
    serve();
  if (fixture_scenario == 0U || fixture_stable_user == NULL || !fixture_expected_result())
    ExitProcess(1U);
  if (!HeapFree(GetProcessHeap(), 0U, fixture_stable_user)) ExitProcess(1U);
  ExitProcess(0U);
}

#endif
