#define OP_WINDOWS_BROKER_FIXTURE 1
#if defined(OP_WINDOWS_ADMISSION_OS_FIXTURE)
static int fixture_admission_terminal_mode;
#define OP_WINDOWS_MODULE_CANDIDATE_PROOF_ENABLED() \
  (!fixture_admission_terminal_mode)
#endif
#if !defined(OP_WINDOWS_ABSENCE_VERIFIER) && \
    !defined(OP_WINDOWS_ADMISSION_FIXTURE) && \
    !defined(OP_WINDOWS_ADMISSION_OS_FIXTURE)
#define NetworkIsolationEnumAppContainers fixture_enum_appcontainers
#define NetworkIsolationFreeAppContainers fixture_free_appcontainers
#endif
#include "../../packages/conformance/src/windows-isolation-broker.c"

#if defined(OP_WINDOWS_ADMISSION_OS_FIXTURE)
#undef CreatePipe
#undef SetHandleInformation
#undef GetHandleInformation
#undef CreateEventW
#undef InitializeProcThreadAttributeList
#undef UpdateProcThreadAttribute
#undef DeleteProcThreadAttributeList
#undef CreateProcessW
#undef GetExitCodeProcess
#undef CloseHandle
#undef OpenProcessToken
#undef OpenThreadToken
#undef GetTokenInformation
#undef IsProcessInJob
#undef DuplicateTokenEx
#undef ImpersonateLoggedOnUser
#undef RevertToSelf
#undef OpenJobObjectW
#undef CreateJobObjectW
#undef SetInformationJobObject
#undef QueryInformationJobObject
#undef TerminateJobObject
#undef WaitForSingleObject
#undef WriteFile
#undef ReadFile
#undef CreateThread
#undef ResumeThread
#undef GetTickCount64
#undef HeapFree
#undef HeapAlloc
#undef FreeSid
#undef GetModuleFileNameW
#endif

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

#if defined(OP_WINDOWS_EXECUTION_FIXTURE)
#undef CreateDirectoryW
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
#endif

#if defined(OP_WINDOWS_ADMISSION_OS_FIXTURE)

#define ADMISSION_FIXTURE_PROCESS ((HANDLE)0x501U)
#define ADMISSION_FIXTURE_THREAD ((HANDLE)0x502U)
#define ADMISSION_FIXTURE_JOB ((HANDLE)0x503U)
#define ADMISSION_FIXTURE_PROCESS_TOKEN ((HANDLE)0x504U)
#define ADMISSION_FIXTURE_IMPERSONATION_TOKEN ((HANDLE)0x505U)

static EXECUTION_CUSTODY *fixture_admission_execution;
static BYTE fixture_admission_profiles[4];
static BYTE fixture_admission_original[4][4];
static BYTE fixture_admission_grant[4] = {9U, 8U, 7U, 6U};
static BYTE fixture_admission_third[4] = {6U, 7U, 8U, 9U};
static BYTE fixture_admission_order[128];
static DWORD fixture_admission_order_count;
static DWORD fixture_admission_fail_call;
static DWORD fixture_admission_call;
static DWORD fixture_admission_attribute_mask;
static DWORD fixture_admission_access_count;
static DWORD fixture_admission_open_count;
static DWORD fixture_admission_access_fail;
static DWORD fixture_admission_open_fail;
static DWORD fixture_admission_token_fault;
static DWORD fixture_admission_query_fault;
static TOKEN_INFORMATION_CLASS fixture_admission_query_kind;
static int fixture_admission_impersonating;
static DWORD fixture_admission_job_fault;
static DWORD fixture_admission_job_active;
static int fixture_admission_job_present;
static ADMISSION_PLAN *fixture_admission_job_plan;
static ADMISSION_CUSTODY *fixture_admission_job_identity;
static ADMISSION_PLAN *fixture_admission_launch_plan;
static HANDLE fixture_admission_pipe_reads[3];
static HANDLE fixture_admission_pipe_writes[3];
static DWORD fixture_admission_pipe_count;
static DWORD fixture_admission_handle_clear_count;
static BYTE fixture_admission_persisted[16];
static DWORD fixture_admission_persisted_count;
static BYTE fixture_admission_persist_failure;
static DWORD fixture_admission_component_failure;
static DWORD fixture_admission_cleanup_count;
static DWORD fixture_admission_restore_count;
static DWORD fixture_admission_matrix_stage;
static DWORD fixture_admission_resource_kind;
static DWORD fixture_admission_resource_call;
static DWORD fixture_admission_resource_failure;
static int fixture_admission_track_allocations;
static DWORD fixture_admission_allocations;
static DWORD fixture_admission_attribute_deletes;
static DWORD fixture_admission_pipe_drains;
static int fixture_admission_terminal_timeout;
static int fixture_admission_terminal_killed;
static DWORD fixture_admission_terminal_exit_code;
static DWORD fixture_admission_resume_result;
static DWORD fixture_admission_resume_count;
static ULONGLONG fixture_admission_tick;
static DWORD fixture_terminal_allocation_call;
static DWORD fixture_terminal_allocation_failure;
static DWORD fixture_terminal_thread_call;
static DWORD fixture_terminal_thread_failure;
static DWORD fixture_terminal_thread_zero_identifier;
static HANDLE fixture_terminal_thread_handles[TERMINAL_WORKER_COUNT];
static DWORD fixture_terminal_wait_failure_kind;
static DWORD fixture_terminal_write_fault;
static DWORD fixture_terminal_read_fault[2];
static DWORD fixture_terminal_read_total[2];
static HANDLE fixture_terminal_pipe_handles[TERMINAL_WORKER_COUNT];
static LPVOID fixture_terminal_buffers[2];
static DWORD fixture_terminal_buffer_frees;
static DWORD fixture_terminal_tick_fault;
static DWORD fixture_terminal_tick_call;
static HANDLE fixture_terminal_response_handle;
static DWORD fixture_terminal_response_fault;
static int fixture_terminal_order_mode;
static BYTE fixture_terminal_order[128];
static DWORD fixture_terminal_order_count;
static DWORD fixture_terminal_close_fault;
static DWORD fixture_terminal_close_case;
static DWORD fixture_terminal_pipe_close_calls[TERMINAL_WORKER_COUNT];
static DWORD fixture_terminal_thread_close_calls[TERMINAL_WORKER_COUNT];
static DWORD fixture_terminal_buffer_free_failure;
static DWORD fixture_terminal_buffer_free_attempts[2];
static DWORD fixture_terminal_requested_close_fault;
static DWORD fixture_terminal_requested_buffer_free_failure;
static const WCHAR fixture_admission_module_path[] =
    L"\\\\?\\C:\\fixture-broker.exe";
static PROFILE_IDENTITY *fixture_admission_identity;
static ROOT_CUSTODY *fixture_admission_root;
static ROOT_CUSTODY fixture_admission_test_root;
static EXECUTION_CUSTODY fixture_admission_test_execution;
static ADMISSION_PLAN fixture_admission_test_plan;
static WCHAR fixture_admission_expected_command[4096];
static WCHAR fixture_admission_expected_environment[8192];

static int fixture_admission_expected_environment_add(
    DWORD *cursor, PCWSTR key, PCWSTR value) {
  SIZE_T key_units = wide_length(key);
  SIZE_T value_units = wide_length(value);
  if (*cursor + key_units + value_units + 2U >= 8192U) return 0;
  copy_bytes(fixture_admission_expected_environment + *cursor, key,
             key_units * 2U);
  *cursor += (DWORD)key_units;
  fixture_admission_expected_environment[(*cursor)++] = L'=';
  copy_bytes(fixture_admission_expected_environment + *cursor, value,
             value_units * 2U);
  *cursor += (DWORD)value_units;
  fixture_admission_expected_environment[(*cursor)++] = L'\0';
  return 1;
}

static int fixture_admission_object_index(const RETAINED_OBJECT *object) {
  if (object == &fixture_admission_execution->root) return 0;
  for (BYTE role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U)
    if (object == &fixture_admission_execution->targets[role])
      return (int)role + 1;
  return -1;
}

static int fixture_admission_verify_original(ROOT_CUSTODY *root,
                                             EXECUTION_CUSTODY *execution) {
  (void)root;
  (void)execution;
  fixture_admission_order[fixture_admission_order_count++] = 90U;
  for (DWORD index = 0U; index < 4U; index += 1U)
    if (fixture_admission_profiles[index] != 0U) return 0;
  return 1;
}

static int fixture_admission_set_security(ROOT_CUSTODY *root,
                                          RETAINED_OBJECT *object,
                                          PSECURITY_DESCRIPTOR security,
                                          DWORD length) {
  int index = fixture_admission_object_index(object);
  (void)root;
  if (index < 0 || length != 4U) return 0;
  fixture_admission_order[fixture_admission_order_count++] =
      (BYTE)(security == fixture_admission_grant ? 10 + index : 20 + index);
  fixture_admission_call += 1U;
  if (fixture_admission_call == fixture_admission_fail_call) return 0;
  fixture_admission_profiles[index] =
      security == fixture_admission_grant ? 1U : 0U;
  return 1;
}

static int fixture_admission_verify_object(ROOT_CUSTODY *root,
                                           RETAINED_OBJECT *object,
                                           const CHAR *domain, BYTE role,
                                           const BYTE *binding) {
  (void)root;
  (void)object;
  (void)domain;
  (void)role;
  (void)binding;
  fixture_admission_order[fixture_admission_order_count++] = 91U;
  {
    int index = fixture_admission_object_index(object);
    if (index >= 0 && fixture_admission_profiles[index] != 0U) return 0;
  }
  return 1;
}

static int fixture_admission_census(ROOT_CUSTODY *root,
                                    const RETAINED_OBJECT *object) {
  (void)root;
  (void)object;
  fixture_admission_order[fixture_admission_order_count++] = 92U;
  return 1;
}

static int fixture_admission_capture_security(ROOT_CUSTODY *root, HANDLE handle,
                                              PSECURITY_DESCRIPTOR *security,
                                              DWORD *length) {
  SIZE_T value = (SIZE_T)handle;
  DWORD index;
  const BYTE *source;
  (void)root;
  if (value < 0x201U || value > 0x204U) return 0;
  index = (DWORD)(value - 0x201U);
  source = fixture_admission_profiles[index] == 0U
               ? fixture_admission_original[index]
               : (fixture_admission_profiles[index] == 1U
                      ? fixture_admission_grant
                      : fixture_admission_third);
  *security = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, 4U);
  if (*security == NULL) return 0;
  copy_bytes(*security, source, 4U);
  *length = 4U;
  return 1;
}

static int fixture_admission_capture_job_security(
    ROOT_CUSTODY *root, HANDLE handle, PSECURITY_DESCRIPTOR *security,
    DWORD *length) {
  const BYTE *source;
  (void)root;
  if (handle != ADMISSION_FIXTURE_JOB || fixture_admission_job_plan == NULL)
    return 0;
  source = fixture_admission_job_fault == 10U
               ? fixture_admission_third
               : (const BYTE *)fixture_admission_job_plan->job_security;
  *length = fixture_admission_job_plan->job_security_length;
  *security = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, *length);
  if (*security == NULL) return 0;
  copy_bytes(*security, source, *length);
  return 1;
}

static int fixture_admission_access(ROOT_CUSTODY *root, HANDLE token,
                                    HANDLE object, DWORD desired,
                                    int expected_allowed) {
  DWORD ordinal = fixture_admission_access_count + 1U;
  HANDLE expected_object = NULL;
  DWORD expected_right = 0U;
  int expected_result = 0;
  if (token != ADMISSION_FIXTURE_IMPERSONATION_TOKEN || object == NULL ||
      desired == 0U || (expected_allowed != 0 && expected_allowed != 1))
    return 0;
  if (fixture_admission_terminal_mode) {
    DWORD object_index = (ordinal - 1U) / 7U;
    DWORD right_index = (ordinal - 1U) % 7U;
    static const DWORD revoked_rights[] = {
      GENERIC_READ, GENERIC_EXECUTE, GENERIC_WRITE, DELETE, WRITE_DAC,
      WRITE_OWNER, ACCESS_SYSTEM_SECURITY
    };
    expected_object = object_index < EXECUTION_ROLE_COUNT
                          ? fixture_admission_execution->targets[object_index].handle
                          : fixture_admission_execution->root.handle;
    expected_right = revoked_rights[right_index];
    if (ordinal > 28U || object != expected_object || desired != expected_right ||
        expected_allowed != 0)
      return 0;
    fixture_admission_access_count += 1U;
    fixture_admission_order[fixture_admission_order_count++] = 93U;
    if (fixture_terminal_order_mode)
      fixture_terminal_order[fixture_terminal_order_count++] = 93U;
    return fixture_admission_access_count != fixture_admission_access_fail;
  }
  if (ordinal <= 21U) {
    DWORD role = (ordinal - 1U) / 7U;
    DWORD member = (ordinal - 1U) % 7U;
    expected_object = fixture_admission_execution->targets[role].handle;
    expected_right = member == 0U ? GENERIC_READ | GENERIC_EXECUTE :
                                    denied_execution_rights[member - 1U];
    expected_result = member == 0U;
  } else if (ordinal == 22U) {
    expected_object = fixture_admission_execution->root.handle;
    expected_right = GENERIC_READ | GENERIC_EXECUTE;
    expected_result = 1;
  } else if (ordinal == 23U) {
    expected_object = fixture_admission_execution->parent.handle;
    expected_right = FILE_LIST_DIRECTORY;
  } else if (ordinal == 24U) {
    expected_object = root->handle;
    expected_right = FILE_LIST_DIRECTORY;
  } else if (ordinal <= 30U) {
    expected_object = fixture_admission_execution->root.handle;
    expected_right = denied_execution_rights[ordinal - 25U];
  } else if (ordinal <= 54U) {
    DWORD member = ordinal - 31U;
    RETAINED_OBJECT *objects[3] = {
      &module_custody.image, &module_custody.source, &module_custody.parent
    };
    expected_object = objects[member / 8U]->handle;
    expected_right = denied_broker_rights[member % 8U];
  } else if (ordinal == 55U) {
    expected_object = module_custody.parent.handle;
    expected_right = FILE_LIST_DIRECTORY;
  } else if (ordinal == 56U) {
    expected_object = module_custody.parent.handle;
    expected_right = FILE_TRAVERSE;
  } else {
    return 0;
  }
  if (object != expected_object || desired != expected_right ||
      expected_allowed != expected_result)
    return 0;
  fixture_admission_access_count += 1U;
  if (fixture_admission_terminal_mode && expected_allowed == 0)
    fixture_admission_order[fixture_admission_order_count++] = 93U;
  if (fixture_terminal_order_mode && expected_allowed == 0)
    fixture_terminal_order[fixture_terminal_order_count++] = 93U;
  return fixture_admission_access_count != fixture_admission_access_fail;
}

static int fixture_admission_open(PCWSTR path, DWORD access, int directory,
                                  int expected_allowed) {
  DWORD ordinal = fixture_admission_open_count + 1U;
  PCWSTR expected_path = NULL;
  DWORD expected_access = 0U;
  int expected_directory = 0;
  int expected_result = 0;
  if (path == NULL || path[0] == L'\0' || access == 0U ||
      (directory != 0 && directory != 1) ||
      (expected_allowed != 0 && expected_allowed != 1))
    return 0;
  if (fixture_admission_terminal_mode) {
    DWORD object_index = (ordinal - 1U) / 7U;
    DWORD right_index = (ordinal - 1U) % 7U;
    static const DWORD revoked_rights[] = {
      GENERIC_READ, GENERIC_EXECUTE, GENERIC_WRITE, DELETE, WRITE_DAC,
      WRITE_OWNER, ACCESS_SYSTEM_SECURITY
    };
    expected_path = object_index < EXECUTION_ROLE_COUNT
                        ? fixture_admission_execution->targets[object_index].path
                        : fixture_admission_execution->root.path;
    expected_access = revoked_rights[right_index];
    expected_directory = object_index == EXECUTION_ROLE_COUNT;
    if (ordinal > 28U || path != expected_path || access != expected_access ||
        directory != expected_directory || expected_allowed != 0)
      return 0;
    fixture_admission_open_count += 1U;
    fixture_admission_order[fixture_admission_order_count++] = 94U;
    if (fixture_terminal_order_mode)
      fixture_terminal_order[fixture_terminal_order_count++] = 94U;
    return fixture_admission_open_count != fixture_admission_open_fail;
  }
  if (ordinal == 1U) {
    expected_path = fixture_admission_execution->root.path;
    expected_access = GENERIC_READ | GENERIC_EXECUTE;
    expected_directory = 1;
    expected_result = 1;
  } else if (ordinal <= 7U) {
    DWORD role = (ordinal - 2U) / 2U;
    int target = ((ordinal - 2U) & 1U) == 0U;
    expected_path = target ? fixture_admission_execution->targets[role].path :
                             fixture_admission_execution->sources[role].path;
    expected_access = target ? GENERIC_READ | GENERIC_EXECUTE : GENERIC_READ;
    expected_result = target;
  } else if (ordinal <= 25U) {
    DWORD member = ordinal - 8U;
    DWORD role = member / 6U;
    expected_path = fixture_admission_execution->targets[role].path;
    expected_access = denied_execution_rights[member % 6U];
  } else if (ordinal <= 31U) {
    expected_path = fixture_admission_execution->root.path;
    expected_access = denied_execution_rights[ordinal - 26U];
    expected_directory = 1;
  } else if (ordinal == 32U) {
    expected_path = fixture_admission_execution->parent.path;
    expected_access = FILE_LIST_DIRECTORY;
    expected_directory = 1;
  } else if (ordinal == 33U) {
    expected_path = fixture_admission_root->path;
    expected_access = FILE_LIST_DIRECTORY;
    expected_directory = 1;
  } else if (ordinal <= 57U) {
    DWORD member = ordinal - 34U;
    RETAINED_OBJECT *objects[3] = {
      &module_custody.image, &module_custody.source, &module_custody.parent
    };
    expected_path = objects[member / 8U]->path;
    expected_access = denied_broker_rights[member % 8U];
    expected_directory = member / 8U == 2U;
  } else if (ordinal == 58U) {
    expected_path = module_custody.parent.path;
    expected_access = FILE_LIST_DIRECTORY;
    expected_directory = 1;
  } else if (ordinal == 59U) {
    expected_path = module_custody.parent.path;
    expected_access = FILE_TRAVERSE;
    expected_directory = 1;
  } else {
    return 0;
  }
  if ((expected_path != NULL && path != expected_path) ||
      access != expected_access || directory != expected_directory ||
      expected_allowed != expected_result)
    return 0;
  fixture_admission_open_count += 1U;
  if (fixture_admission_terminal_mode && expected_allowed == 0)
    fixture_admission_order[fixture_admission_order_count++] = 94U;
  if (fixture_terminal_order_mode && expected_allowed == 0)
    fixture_terminal_order[fixture_terminal_order_count++] = 94U;
  return fixture_admission_open_count != fixture_admission_open_fail;
}

static int fixture_admission_scratch(ROOT_CUSTODY *root,
                                     const PROFILE_IDENTITY *identity) {
  (void)root;
  (void)identity;
  if (fixture_admission_terminal_mode)
    fixture_admission_order[fixture_admission_order_count++] = 83U;
  if (fixture_terminal_order_mode)
    fixture_terminal_order[fixture_terminal_order_count++] = 83U;
  return fixture_admission_token_fault != 17U;
}

static int fixture_admission_verify_job(ROOT_CUSTODY *root, HANDLE job,
                                        const ADMISSION_PLAN *plan,
                                        DWORD expected_processes,
                                        DWORD expected_process_id) {
  (void)root;
  (void)plan;
  if (job != ADMISSION_FIXTURE_JOB) return 0;
  if (fixture_admission_token_fault == 12U) return 0;
  return (expected_processes == 1U && expected_process_id == 777U) ||
         expected_processes == 0U || expected_processes == 0xffffffffU;
}

static int fixture_admission_launch_step(void) {
  fixture_admission_call += 1U;
  return fixture_admission_call != fixture_admission_fail_call;
}

static BOOL WINAPI fixture_admission_CreatePipe(HANDLE *read_handle,
                                                HANDLE *write_handle,
                                                SECURITY_ATTRIBUTES *attributes,
                                                DWORD size) {
  SIZE_T base = 0x600U + fixture_admission_call * 2U;
  if (!fixture_admission_launch_step() || attributes == NULL ||
      attributes->nLength != sizeof(*attributes) ||
      attributes->lpSecurityDescriptor != NULL ||
      attributes->bInheritHandle != TRUE || size != 0U)
    return FALSE;
  *read_handle = (HANDLE)base;
  *write_handle = (HANDLE)(base + 1U);
  if (fixture_admission_pipe_count >= 3U) return FALSE;
  fixture_admission_pipe_reads[fixture_admission_pipe_count] = *read_handle;
  fixture_admission_pipe_writes[fixture_admission_pipe_count] = *write_handle;
  fixture_admission_pipe_count += 1U;
  return TRUE;
}

static BOOL WINAPI fixture_admission_SetHandleInformation(HANDLE handle,
                                                          DWORD mask,
                                                          DWORD flags) {
  static const BYTE pipe_index[] = {0U, 1U, 2U};
  HANDLE expected;
  if (fixture_admission_handle_clear_count >= 3U) return FALSE;
  expected = fixture_admission_handle_clear_count == 0U
                 ? fixture_admission_pipe_writes[pipe_index[0]]
                 : fixture_admission_pipe_reads[
                       pipe_index[fixture_admission_handle_clear_count]];
  fixture_admission_handle_clear_count += 1U;
  return fixture_admission_launch_step() && handle == expected &&
         mask == HANDLE_FLAG_INHERIT && flags == 0U;
}

static BOOL WINAPI fixture_admission_GetHandleInformation(HANDLE handle,
                                                          DWORD *flags) {
  if (!fixture_admission_launch_step() || handle == NULL || flags == NULL)
    return FALSE;
  *flags = 0U;
  return TRUE;
}

static HANDLE WINAPI fixture_admission_CreateEventW(
    SECURITY_ATTRIBUTES *attributes, BOOL manual, BOOL initial, PCWSTR name) {
  if (!fixture_admission_launch_step() || attributes == NULL ||
      attributes->bInheritHandle != TRUE || manual != TRUE ||
      initial != FALSE || name != NULL)
    return NULL;
  return (HANDLE)0x620U;
}

static BOOL WINAPI fixture_admission_InitializeProcThreadAttributeList(
    LPVOID attributes, DWORD count, DWORD flags, SIZE_T *bytes) {
  if (!fixture_admission_launch_step() || count != 3U || flags != 0U ||
      bytes == NULL)
    return FALSE;
  if (attributes == NULL) {
    *bytes = 64U;
    SetLastError(ERROR_INSUFFICIENT_BUFFER);
    return FALSE;
  }
  return *bytes == 64U;
}

static BOOL WINAPI fixture_admission_UpdateProcThreadAttribute(
    LPVOID attributes, DWORD flags, SIZE_T kind, LPVOID value, SIZE_T bytes,
    LPVOID previous, SIZE_T *returned) {
  if (!fixture_admission_launch_step() || attributes == NULL || flags != 0U ||
      value == NULL || previous != NULL || returned != NULL)
    return FALSE;
  if (kind == PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES) {
    SECURITY_CAPABILITIES *capabilities = (SECURITY_CAPABILITIES *)value;
    if (bytes != sizeof(*capabilities) ||
        capabilities->AppContainerSid !=
            (PSID)fixture_admission_identity->sid ||
        capabilities->Capabilities != NULL ||
        capabilities->CapabilityCount != 0U || capabilities->Reserved != 0U)
      return FALSE;
    fixture_admission_attribute_mask |= 1U;
  } else if (kind == PROC_THREAD_ATTRIBUTE_JOB_LIST) {
    if (bytes != sizeof(HANDLE) || ((HANDLE *)value)[0] != ADMISSION_FIXTURE_JOB)
      return FALSE;
    fixture_admission_attribute_mask |= 2U;
  } else if (kind == PROC_THREAD_ATTRIBUTE_HANDLE_LIST) {
    if (bytes != 3U * sizeof(HANDLE) ||
        ((HANDLE *)value)[0] != fixture_admission_pipe_reads[0] ||
        ((HANDLE *)value)[1] != fixture_admission_pipe_writes[1] ||
        ((HANDLE *)value)[2] != fixture_admission_pipe_writes[2])
      return FALSE;
    fixture_admission_attribute_mask |= 4U;
  } else {
    return FALSE;
  }
  return TRUE;
}

static void WINAPI fixture_admission_DeleteProcThreadAttributeList(
    LPVOID attributes) {
  if (attributes != NULL) fixture_admission_attribute_deletes += 1U;
}

static BOOL WINAPI fixture_admission_CreateProcessW(
    PCWSTR application, LPWSTR command, SECURITY_ATTRIBUTES *process_security,
    SECURITY_ATTRIBUTES *thread_security, BOOL inherit, DWORD flags,
    LPVOID environment, PCWSTR cwd, STARTUPINFOW *startup,
    PROCESS_INFORMATION *process) {
  ADMISSION_PLAN *plan = fixture_admission_launch_plan;
  if (!fixture_admission_launch_step() || plan == NULL ||
      application == NULL || !wide_equal(application, plan->application) ||
      command == NULL || command == plan->command_line ||
      !wide_equal(command, plan->command_line) ||
      process_security != NULL || thread_security != NULL ||
      inherit != TRUE || environment != plan->environment || cwd == NULL ||
      !wide_equal(cwd, plan->cwd) || flags != plan->creation_flags ||
      startup == NULL || process == NULL ||
      startup->cb != sizeof(STARTUPINFOEXW) ||
      startup->dwFlags != STARTF_USESTDHANDLES ||
      startup->hStdInput != fixture_admission_pipe_reads[0] ||
      startup->hStdOutput != fixture_admission_pipe_writes[1] ||
      startup->hStdError != fixture_admission_pipe_writes[2] ||
      fixture_admission_attribute_mask != 7U)
    return FALSE;
  process->hProcess = ADMISSION_FIXTURE_PROCESS;
  process->hThread = ADMISSION_FIXTURE_THREAD;
  process->dwProcessId = 777U;
  process->dwThreadId = 778U;
  return TRUE;
}

static BOOL WINAPI fixture_admission_GetExitCodeProcess(HANDLE process,
                                                        DWORD *code) {
  if (fixture_admission_terminal_mode) {
    if (process != ADMISSION_FIXTURE_PROCESS || code == NULL) return FALSE;
    *code = fixture_admission_terminal_exit_code;
    return TRUE;
  }
  if (!fixture_admission_launch_step() ||
      process != ADMISSION_FIXTURE_PROCESS || code == NULL)
    return FALSE;
  *code = STILL_ACTIVE;
  return TRUE;
}

static BOOL WINAPI fixture_admission_CloseHandle(HANDLE handle) {
  int resource_failure = 0;
  if (fixture_admission_terminal_mode) {
    for (DWORD index = 0U; index < TERMINAL_WORKER_COUNT; index += 1U) {
      if (handle == fixture_terminal_pipe_handles[index]) {
        DWORD transient = index + 1U;
        DWORD persistent = index + 4U;
        fixture_terminal_pipe_close_calls[index] += 1U;
        if (fixture_terminal_close_fault == transient) {
          fixture_terminal_close_fault = 0U;
          return FALSE;
        }
        if (fixture_terminal_close_fault == persistent) return FALSE;
      }
      if (handle == fixture_terminal_thread_handles[index]) {
        DWORD transient = index + 7U;
        DWORD persistent = index + 10U;
        fixture_terminal_thread_close_calls[index] += 1U;
        if (fixture_terminal_close_fault == transient) {
          fixture_terminal_close_fault = 0U;
          return FALSE;
        }
        if (fixture_terminal_close_fault == persistent) return FALSE;
      }
    }
  }
  if ((fixture_admission_resource_kind == 3U ||
       fixture_admission_resource_kind == 4U) && handle != NULL &&
      handle != INVALID_HANDLE_VALUE) {
    fixture_admission_resource_call += 1U;
    resource_failure = fixture_admission_resource_kind == 4U ||
                       fixture_admission_resource_call ==
                           fixture_admission_resource_failure;
  }
  if (handle == ADMISSION_FIXTURE_JOB) {
    fixture_admission_job_present = 0;
    if (fixture_admission_job_fault == 25U) return FALSE;
  }
  if (resource_failure) return FALSE;
  if (fixture_admission_terminal_mode) {
    if (handle == ADMISSION_FIXTURE_PROCESS ||
        handle == ADMISSION_FIXTURE_THREAD ||
        handle == ADMISSION_FIXTURE_JOB ||
        handle == ADMISSION_FIXTURE_PROCESS_TOKEN ||
        handle == ADMISSION_FIXTURE_IMPERSONATION_TOKEN)
      return TRUE;
    return CloseHandle(handle);
  }
  return handle != NULL && handle != INVALID_HANDLE_VALUE &&
         fixture_admission_launch_step();
}

static DWORD fixture_admission_sid_bytes(BYTE *target,
                                         SID_IDENTIFIER_AUTHORITY authority,
                                         DWORD count, DWORD first,
                                         DWORD second) {
  DWORD length = 8U + count * 4U;
  zero_bytes(target, length);
  target[0] = 1U;
  target[1] = (BYTE)count;
  copy_bytes(target + 2U, authority.Value, 6U);
  if (count > 0U) write_u32(target + 8U, first);
  if (count > 1U) write_u32(target + 12U, second);
  return length;
}

static BOOL WINAPI fixture_admission_OpenProcessToken(HANDLE process,
                                                      DWORD access,
                                                      HANDLE *token) {
  if (fixture_admission_token_fault == 1U ||
      process != ADMISSION_FIXTURE_PROCESS ||
      access != (TOKEN_QUERY | TOKEN_DUPLICATE) || token == NULL)
    return FALSE;
  *token = ADMISSION_FIXTURE_PROCESS_TOKEN;
  return TRUE;
}

static BOOL WINAPI fixture_admission_GetTokenInformation(
    HANDLE token, TOKEN_INFORMATION_CLASS kind, LPVOID output, DWORD capacity,
    DWORD *returned) {
  BYTE sid[SID_MAX_BYTES];
  DWORD sid_length;
  DWORD fixed;
  DWORD needed;
  DWORD group_sid_length = 0U;
  SID_IDENTIFIER_AUTHORITY mandatory = SECURITY_MANDATORY_LABEL_AUTHORITY;
  if (token != ADMISSION_FIXTURE_PROCESS_TOKEN || returned == NULL)
    return FALSE;
  if (kind == TokenIsAppContainer) {
    if (output == NULL || capacity != sizeof(BOOL)) return FALSE;
    *(BOOL *)output = fixture_admission_token_fault == 2U ? FALSE : TRUE;
    *returned = fixture_admission_token_fault == 3U ? sizeof(BOOL) - 1U :
                                                     sizeof(BOOL);
    return TRUE;
  }
  if (kind == TokenElevation) {
    if (output == NULL || capacity != sizeof(TOKEN_ELEVATION)) return FALSE;
    ((TOKEN_ELEVATION *)output)->TokenIsElevated =
        fixture_admission_token_fault == 4U ? 1U : 0U;
    *returned = sizeof(TOKEN_ELEVATION);
    return TRUE;
  }
  if (kind == TokenUIAccess) {
    if (output == NULL || capacity != sizeof(DWORD)) return FALSE;
    *(DWORD *)output = fixture_admission_token_fault == 5U ? 1U : 0U;
    *returned = sizeof(DWORD);
    return TRUE;
  }
  if (kind == TokenUser) {
    sid_length = fixture_admission_root->stable_sid_length;
    copy_bytes(sid, fixture_admission_root->stable_sid, sid_length);
    if (fixture_admission_token_fault == 6U) sid[sid_length - 1U] ^= 1U;
    fixed = sizeof(TOKEN_USER);
  } else if (kind == TokenAppContainerSid) {
    sid_length = fixture_admission_identity->sid_length;
    copy_bytes(sid, fixture_admission_identity->sid, sid_length);
    if (fixture_admission_token_fault == 7U) sid[sid_length - 1U] ^= 1U;
    fixed = sizeof(TOKEN_APPCONTAINER_INFORMATION);
  } else if (kind == TokenIntegrityLevel) {
    sid_length = fixture_admission_sid_bytes(
        sid, mandatory, 1U,
        fixture_admission_token_fault == 8U ? 0x00002000U :
                                              SECURITY_MANDATORY_LOW_RID,
        0U);
    fixed = sizeof(TOKEN_MANDATORY_LABEL);
  } else if (kind == TokenCapabilities || kind == TokenGroups) {
    fixed = (DWORD)__builtin_offsetof(TOKEN_GROUPS, Groups);
    needed = fixed;
    if (kind == TokenGroups && fixture_admission_token_fault == 24U)
      needed = fixed + (DWORD)sizeof(SID_AND_ATTRIBUTES) +
               fixture_admission_root->stable_sid_length;
    if (kind == TokenGroups && fixture_admission_token_fault == 25U)
      needed = fixed + 2U * (DWORD)sizeof(SID_AND_ATTRIBUTES) +
               2U * fixture_admission_identity->sid_length;
    if (kind == TokenGroups && fixture_admission_token_fault >= 33U &&
        fixture_admission_token_fault <= 38U) {
      if (fixture_admission_token_fault == 35U) {
        group_sid_length = fixture_admission_root->stable_sid_length;
        copy_bytes(sid, fixture_admission_root->stable_sid,
                   group_sid_length);
      } else if (fixture_admission_token_fault == 36U) {
        SID_IDENTIFIER_AUTHORITY nt = SECURITY_NT_AUTHORITY;
        group_sid_length = fixture_admission_sid_bytes(
            sid, nt, 1U, SECURITY_LOCAL_SYSTEM_RID, 0U);
      } else if (fixture_admission_token_fault == 37U) {
        SID_IDENTIFIER_AUTHORITY nt = SECURITY_NT_AUTHORITY;
        group_sid_length = fixture_admission_sid_bytes(
            sid, nt, 2U, SECURITY_BUILTIN_DOMAIN_RID,
            DOMAIN_ALIAS_RID_ADMINS);
      } else {
        group_sid_length = fixture_admission_identity->sid_length;
        copy_bytes(sid, fixture_admission_identity->sid, group_sid_length);
      }
      needed = fixed + (DWORD)sizeof(SID_AND_ATTRIBUTES) +
               group_sid_length +
               (fixture_admission_token_fault == 38U ? 4U : 0U);
    }
    if (kind == TokenGroups && fixture_admission_token_fault == 39U)
      needed = fixed + 4U;
    if (kind == TokenGroups && fixture_admission_token_fault == 40U)
      needed = fixed + 129U * (DWORD)sizeof(SID_AND_ATTRIBUTES) +
               129U * 12U;
    if (kind == TokenCapabilities && fixture_admission_token_fault == 41U)
      needed = fixed + (DWORD)sizeof(SID_AND_ATTRIBUTES) +
               fixture_admission_identity->sid_length;
    if (output == NULL) {
      if (kind == fixture_admission_query_kind &&
          fixture_admission_query_fault == 1U) {
        *returned = needed;
        SetLastError(ERROR_ACCESS_DENIED);
        return FALSE;
      }
      *returned = kind == fixture_admission_query_kind &&
                          fixture_admission_query_fault == 2U
                      ? 0U
                      : (kind == fixture_admission_query_kind &&
                                 fixture_admission_query_fault == 3U
                             ? TOKEN_BUFFER_MAXIMUM + 1U
                             : needed);
      SetLastError(ERROR_INSUFFICIENT_BUFFER);
      return FALSE;
    }
    if (kind == fixture_admission_query_kind &&
        fixture_admission_query_fault == 4U)
      return FALSE;
    if (capacity != needed) return FALSE;
    zero_bytes(output, needed);
    if ((kind == TokenCapabilities && fixture_admission_token_fault == 9U) ||
        (kind == TokenGroups && fixture_admission_token_fault == 10U))
      ((TOKEN_GROUPS *)output)->GroupCount = 1U;
    if (kind == TokenCapabilities && fixture_admission_token_fault == 23U)
      ((TOKEN_GROUPS *)output)->GroupCount = 129U;
    if (kind == TokenGroups && fixture_admission_token_fault == 24U) {
      TOKEN_GROUPS *groups = (TOKEN_GROUPS *)output;
      BYTE *sid_start = (BYTE *)output + fixed + sizeof(SID_AND_ATTRIBUTES);
      groups->GroupCount = 1U;
      groups->Groups[0].Sid = sid_start;
      groups->Groups[0].Attributes = SE_GROUP_ENABLED;
      copy_bytes(sid_start, fixture_admission_root->stable_sid,
                 fixture_admission_root->stable_sid_length);
    }
    if (kind == TokenGroups && fixture_admission_token_fault == 25U) {
      TOKEN_GROUPS *groups = (TOKEN_GROUPS *)output;
      BYTE *sid_start =
          (BYTE *)output + fixed + 2U * sizeof(SID_AND_ATTRIBUTES);
      groups->GroupCount = 2U;
      groups->Groups[0].Sid = sid_start;
      groups->Groups[1].Sid =
          sid_start + fixture_admission_identity->sid_length;
      copy_bytes(groups->Groups[0].Sid, fixture_admission_identity->sid,
                 fixture_admission_identity->sid_length);
      copy_bytes(groups->Groups[1].Sid, fixture_admission_identity->sid,
                 fixture_admission_identity->sid_length);
    }
    if (kind == TokenGroups && fixture_admission_token_fault >= 33U &&
        fixture_admission_token_fault <= 38U) {
      TOKEN_GROUPS *groups = (TOKEN_GROUPS *)output;
      BYTE *sid_start = (BYTE *)output + fixed + sizeof(SID_AND_ATTRIBUTES);
      groups->GroupCount = 1U;
      if (fixture_admission_token_fault == 38U) sid_start += 4U;
      groups->Groups[0].Sid = sid_start;
      groups->Groups[0].Attributes =
          fixture_admission_token_fault == 33U
              ? 0x10000000U
              : (fixture_admission_token_fault == 34U
                     ? SE_GROUP_ENABLED | SE_GROUP_USE_FOR_DENY_ONLY
                     : (fixture_admission_token_fault >= 35U &&
                                fixture_admission_token_fault <= 37U
                            ? SE_GROUP_ENABLED
                            : 0U));
      copy_bytes(sid_start, sid, group_sid_length);
    }
    if (kind == TokenGroups && fixture_admission_token_fault == 40U) {
      TOKEN_GROUPS *groups = (TOKEN_GROUPS *)output;
      SID_IDENTIFIER_AUTHORITY package =
          {{0U, 0U, 0U, 0U, 0U, 15U}};
      BYTE *sid_start =
          (BYTE *)output + fixed + 129U * sizeof(SID_AND_ATTRIBUTES);
      groups->GroupCount = 129U;
      for (DWORD index = 0U; index < 129U; index += 1U) {
        groups->Groups[index].Sid = sid_start + index * 12U;
        (void)fixture_admission_sid_bytes(
            (BYTE *)groups->Groups[index].Sid, package, 1U, 100U + index,
            0U);
      }
    }
    if (kind == TokenCapabilities && fixture_admission_token_fault == 41U) {
      TOKEN_GROUPS *groups = (TOKEN_GROUPS *)output;
      BYTE *sid_start = (BYTE *)output + fixed + sizeof(SID_AND_ATTRIBUTES);
      groups->GroupCount = 1U;
      groups->Groups[0].Sid = sid_start;
      copy_bytes(sid_start, fixture_admission_identity->sid,
                 fixture_admission_identity->sid_length);
    }
    *returned = kind == fixture_admission_query_kind &&
                        fixture_admission_query_fault == 5U
                    ? needed - 1U : needed;
    return TRUE;
  } else {
    return FALSE;
  }
  needed = fixed + sid_length;
  if (output == NULL) {
    if (kind == fixture_admission_query_kind &&
        fixture_admission_query_fault == 1U) {
      *returned = needed;
      SetLastError(ERROR_ACCESS_DENIED);
      return FALSE;
    }
    *returned = kind == fixture_admission_query_kind &&
                        fixture_admission_query_fault == 2U
                    ? 0U
                    : (kind == fixture_admission_query_kind &&
                               fixture_admission_query_fault == 3U
                           ? TOKEN_BUFFER_MAXIMUM + 1U
                           : needed);
    SetLastError(ERROR_INSUFFICIENT_BUFFER);
    return FALSE;
  }
  if (kind == fixture_admission_query_kind &&
      fixture_admission_query_fault == 4U)
    return FALSE;
  if (capacity != needed) return FALSE;
  zero_bytes(output, needed);
  if (kind == TokenUser)
    ((TOKEN_USER *)output)->User.Sid = (BYTE *)output + fixed;
  else if (kind == TokenAppContainerSid)
    ((TOKEN_APPCONTAINER_INFORMATION *)output)->TokenAppContainer =
        (BYTE *)output + fixed;
  else
    ((TOKEN_MANDATORY_LABEL *)output)->Label.Sid =
        (BYTE *)output + fixed;
  if (kind == TokenUser && fixture_admission_token_fault == 20U)
    ((TOKEN_USER *)output)->User.Sid = NULL;
  if (kind == TokenUser && fixture_admission_token_fault == 28U)
    ((TOKEN_USER *)output)->User.Sid = (BYTE *)output - 4U;
  if (kind == TokenUser && fixture_admission_token_fault == 29U)
    ((TOKEN_USER *)output)->User.Sid = (BYTE *)output + needed;
  if (kind == TokenUser && fixture_admission_token_fault == 30U)
    ((TOKEN_USER *)output)->User.Sid = (BYTE *)output + 4U;
  if (kind == TokenAppContainerSid && fixture_admission_token_fault == 21U)
    ((TOKEN_APPCONTAINER_INFORMATION *)output)->TokenAppContainer =
        (BYTE *)output + 1U;
  copy_bytes((BYTE *)output + fixed, sid, sid_length);
  if (kind == TokenIntegrityLevel && fixture_admission_token_fault == 22U)
    ((BYTE *)output)[fixed] = 0U;
  if (kind == TokenAppContainerSid && fixture_admission_token_fault == 31U)
    ((BYTE *)output)[fixed + 1U] = 16U;
  if (kind == TokenIntegrityLevel && fixture_admission_token_fault == 32U)
    ((BYTE *)output)[fixed + 1U] = 15U;
  if (kind == TokenAppContainerSid && fixture_admission_token_fault == 27U)
    copy_bytes((BYTE *)output + fixed, fixture_admission_root->stable_sid,
               sid_length);
  *returned = (kind == TokenUser && fixture_admission_token_fault == 26U) ||
                      (kind == fixture_admission_query_kind &&
                       fixture_admission_query_fault == 5U)
                  ? needed - 1U : needed;
  return TRUE;
}

static BOOL WINAPI fixture_admission_IsProcessInJob(HANDLE process,
                                                     HANDLE job,
                                                     BOOL *in_job) {
  if (process != ADMISSION_FIXTURE_PROCESS || job != ADMISSION_FIXTURE_JOB ||
      in_job == NULL)
    return FALSE;
  *in_job = fixture_admission_token_fault == 11U ? FALSE : TRUE;
  return TRUE;
}

static BOOL WINAPI fixture_admission_DuplicateTokenEx(
    HANDLE token, DWORD access, SECURITY_ATTRIBUTES *attributes, DWORD level,
    DWORD kind, HANDLE *duplicate) {
  if (fixture_admission_token_fault == 13U ||
      token != ADMISSION_FIXTURE_PROCESS_TOKEN ||
      access != (TOKEN_QUERY | TOKEN_IMPERSONATE) || attributes != NULL ||
      level != SecurityImpersonation || kind != TokenImpersonation ||
      duplicate == NULL)
    return FALSE;
  *duplicate = ADMISSION_FIXTURE_IMPERSONATION_TOKEN;
  return TRUE;
}

static BOOL WINAPI fixture_admission_ImpersonateLoggedOnUser(HANDLE token) {
  if (fixture_admission_token_fault == 15U ||
      token != ADMISSION_FIXTURE_IMPERSONATION_TOKEN)
    return FALSE;
  fixture_admission_impersonating = 1;
  return TRUE;
}

static BOOL WINAPI fixture_admission_RevertToSelf(void) {
  if (fixture_admission_token_fault == 18U) return FALSE;
  fixture_admission_impersonating = 0;
  return TRUE;
}

static HANDLE WINAPI fixture_admission_OpenJobObjectW(DWORD access,
                                                      BOOL inherit,
                                                      PCWSTR name) {
  if (inherit != FALSE || name == NULL ||
      fixture_admission_job_identity == NULL ||
      !wide_equal(name, fixture_admission_job_identity->job_name) ||
      (access != JOB_OBJECT_QUERY &&
       access != (JOB_OBJECT_QUERY | JOB_OBJECT_TERMINATE))) {
    SetLastError(ERROR_ACCESS_DENIED);
    return NULL;
  }
  if (!fixture_admission_job_present) {
    SetLastError(fixture_admission_job_fault == 26U ? ERROR_ACCESS_DENIED :
                                                     ERROR_FILE_NOT_FOUND);
    return NULL;
  }
  return ADMISSION_FIXTURE_JOB;
}

static HANDLE WINAPI fixture_admission_CreateJobObjectW(
    SECURITY_ATTRIBUTES *attributes, PCWSTR name) {
  if (fixture_admission_job_fault == 21U || attributes == NULL ||
      attributes->nLength != sizeof(*attributes) ||
      attributes->lpSecurityDescriptor !=
          fixture_admission_job_plan->job_security ||
      attributes->bInheritHandle != FALSE || name == NULL ||
      !wide_equal(name, fixture_admission_job_identity->job_name))
    return NULL;
  fixture_admission_job_present = 1;
  SetLastError(fixture_admission_job_fault == 22U ? ERROR_ALREADY_EXISTS :
                                                     ERROR_SUCCESS);
  return ADMISSION_FIXTURE_JOB;
}

static BOOL WINAPI fixture_admission_SetInformationJobObject(
    HANDLE job, JOBOBJECTINFOCLASS kind, LPVOID information, DWORD length) {
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION *limits =
      (JOBOBJECT_EXTENDED_LIMIT_INFORMATION *)information;
  return fixture_admission_job_fault != 23U &&
         job == ADMISSION_FIXTURE_JOB &&
         kind == JobObjectExtendedLimitInformation &&
         length == sizeof(*limits) &&
         limits->BasicLimitInformation.LimitFlags ==
             JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
}

static BOOL WINAPI fixture_admission_QueryInformationJobObject(
    HANDLE job, JOBOBJECTINFOCLASS kind, LPVOID information, DWORD length,
    DWORD *returned) {
  if (job != ADMISSION_FIXTURE_JOB || information == NULL || returned == NULL)
    return FALSE;
  if (kind == JobObjectExtendedLimitInformation) {
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION *limits =
        (JOBOBJECT_EXTENDED_LIMIT_INFORMATION *)information;
    if (fixture_admission_job_fault == 1U || length != sizeof(*limits))
      return FALSE;
    zero_bytes(limits, sizeof(*limits));
    limits->BasicLimitInformation.LimitFlags =
        fixture_admission_job_fault == 3U ? 0U :
                                            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    *returned = fixture_admission_job_fault == 2U ? sizeof(*limits) - 1U :
                                                    sizeof(*limits);
    return TRUE;
  }
  if (kind == JobObjectBasicAccountingInformation) {
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION *accounting =
        (JOBOBJECT_BASIC_ACCOUNTING_INFORMATION *)information;
    if (fixture_admission_job_fault == 4U || length != sizeof(*accounting))
      return FALSE;
    zero_bytes(accounting, sizeof(*accounting));
    accounting->ActiveProcesses =
        fixture_admission_job_fault == 9U
            ? fixture_admission_job_active + 1U
            : (fixture_admission_job_fault == 16U ? 2U :
                                                    fixture_admission_job_active);
    *returned = fixture_admission_job_fault == 5U
                    ? sizeof(*accounting) - 1U
                    : sizeof(*accounting);
    return TRUE;
  }
  if (kind == JobObjectBasicProcessIdList) {
    JOBOBJECT_BASIC_PROCESS_ID_LIST *list =
        (JOBOBJECT_BASIC_PROCESS_ID_LIST *)information;
    DWORD assigned = fixture_admission_job_active;
    DWORD listed = assigned;
    DWORD needed;
    if (fixture_admission_job_fault == 13U) {
      assigned = 65U;
      listed = 65U;
    }
    if (fixture_admission_job_fault == 14U) listed = assigned + 1U;
    if (fixture_admission_job_fault == 16U) assigned = listed = 2U;
    if (fixture_admission_job_fault == 17U) assigned = listed = 0U;
    needed = 8U + assigned * (DWORD)sizeof(SIZE_T);
    if (fixture_admission_job_fault == 6U ||
        (length < needed && fixture_admission_job_fault != 13U))
      return FALSE;
    zero_bytes(information, length);
    list->NumberOfAssignedProcesses = assigned;
    list->NumberOfProcessIdsInList =
        fixture_admission_job_fault == 8U ? assigned + 1U : listed;
    if (assigned != 0U)
      list->ProcessIdList[0] =
          fixture_admission_job_fault == 11U
              ? 0U
              : (fixture_admission_job_fault == 12U
                     ? (SIZE_T)0x100000000ULL
                     : (fixture_admission_job_fault == 15U ? 778U : 777U));
    if (assigned > 1U) list->ProcessIdList[1] = 777U;
    *returned = fixture_admission_job_fault == 7U
                    ? needed - 1U
                    : (fixture_admission_job_fault == 13U ? 8U :
                       (fixture_admission_job_fault == 18U ? needed + 8U :
                                                            needed));
    return TRUE;
  }
  return FALSE;
}

static BOOL WINAPI fixture_admission_TerminateJobObject(HANDLE job,
                                                        DWORD code) {
  if (job != ADMISSION_FIXTURE_JOB ||
      (code != EXIT_LIFECYCLE_NOT_IMPLEMENTED &&
       code != EXIT_PROTOCOL_REFUSED) ||
      fixture_admission_job_fault == 24U)
    return FALSE;
  fixture_admission_job_active = 0U;
  fixture_admission_terminal_killed = 1;
  if (fixture_admission_terminal_mode)
    fixture_admission_order[fixture_admission_order_count++] = 82U;
  if (fixture_terminal_order_mode)
    fixture_terminal_order[fixture_terminal_order_count++] = 82U;
  return TRUE;
}

static DWORD WINAPI fixture_admission_WaitForSingleObject(HANDLE handle,
                                                          DWORD timeout) {
  if (fixture_admission_terminal_mode) {
    if (handle == ADMISSION_FIXTURE_PROCESS) {
      DWORD result = fixture_admission_terminal_timeout &&
                             !fixture_admission_terminal_killed
                         ? WAIT_TIMEOUT
                         : WAIT_OBJECT_0;
      return fixture_terminal_wait_failure_kind == 1U ? 0xffffffffU : result;
    }
    if (handle == ADMISSION_FIXTURE_JOB) return WAIT_OBJECT_0;
    {
      DWORD result = WaitForSingleObject(
          handle, timeout < TERMINAL_CLEANUP_MILLISECONDS
                      ? TERMINAL_CLEANUP_MILLISECONDS
                      : timeout);
      DWORD failure = 0U;
      for (DWORD index = 0U; index < TERMINAL_WORKER_COUNT; index += 1U)
        if (handle == fixture_terminal_thread_handles[index])
          failure = index + 2U;
      return failure == fixture_terminal_wait_failure_kind ? 0xffffffffU :
                                                              result;
    }
  }
  return handle == ADMISSION_FIXTURE_PROCESS && timeout == 5000U ?
             WAIT_OBJECT_0 :
             WAIT_TIMEOUT;
}

static BOOL WINAPI fixture_admission_ReadFile(HANDLE handle, LPVOID bytes,
                                              DWORD length, DWORD *read,
                                              LPVOID overlapped) {
  if (fixture_admission_terminal_mode) {
    DWORD stream = handle == fixture_terminal_pipe_handles[TERMINAL_WORKER_STDERR]
                       ? 1U
                       : 0U;
    DWORD fault = fixture_terminal_read_fault[stream];
    if (fault == 1U && length > 1U) length = 1U;
    if (fault == 2U) {
      *read = 0U;
      return TRUE;
    }
    if (fault == 3U) {
      *read = 0U;
      SetLastError(ERROR_ACCESS_DENIED);
      return FALSE;
    }
    if (fault == 4U || fault == 5U) {
      DWORD bound = TERMINAL_STREAM_MAXIMUM + (fault == 4U ? 1U : 0U);
      DWORD remaining = bound - fixture_terminal_read_total[stream];
      DWORD returned = remaining < length ? remaining : length;
      if (remaining == 0U) {
        *read = 0U;
        SetLastError(ERROR_BROKEN_PIPE);
        return FALSE;
      }
      zero_bytes(bytes, returned);
      fixture_terminal_read_total[stream] += returned;
      *read = returned;
      return TRUE;
    }
    return ReadFile(handle, bytes, length, read, overlapped);
  }
  (void)bytes;
  (void)length;
  if (handle == NULL || read == NULL || overlapped != NULL ||
      fixture_admission_pipe_drains >= 2U ||
      handle != fixture_admission_pipe_reads[
                    fixture_admission_pipe_drains + 1U])
    return FALSE;
  fixture_admission_pipe_drains += 1U;
  *read = 0U;
  SetLastError(ERROR_BROKEN_PIPE);
  return FALSE;
}

static BOOL WINAPI fixture_admission_WriteFile(HANDLE handle, LPCVOID bytes,
                                               DWORD length, DWORD *written,
                                               LPVOID overlapped) {
  if (fixture_admission_terminal_mode &&
      handle == fixture_terminal_pipe_handles[TERMINAL_WORKER_STDIN]) {
    if (fixture_terminal_write_fault == 1U && length > 1U) length = 1U;
    if (fixture_terminal_write_fault == 2U) {
      *written = 0U;
      return TRUE;
    }
    if (fixture_terminal_write_fault == 3U ||
        fixture_terminal_write_fault == 4U) {
      *written = 0U;
      SetLastError(fixture_terminal_write_fault == 3U ? ERROR_BROKEN_PIPE :
                                                        ERROR_ACCESS_DENIED);
      return FALSE;
    }
    if (fixture_terminal_write_fault == 5U) {
      *written = length > 4096U ? 4096U : length;
      return TRUE;
    }
  }
  if (fixture_admission_terminal_mode &&
      handle == fixture_terminal_response_handle) {
    if (fixture_terminal_response_fault == 1U && length > 1U) length = 1U;
    if (fixture_terminal_response_fault == 2U) {
      *written = 0U;
      return TRUE;
    }
    if (fixture_terminal_response_fault == 3U) {
      *written = 0U;
      SetLastError(ERROR_ACCESS_DENIED);
      return FALSE;
    }
  }
  return WriteFile(handle, bytes, length, written, overlapped);
}

static HANDLE WINAPI fixture_admission_CreateThread(
    SECURITY_ATTRIBUTES *attributes, SIZE_T stack_bytes,
    LPTHREAD_START_ROUTINE routine, LPVOID context, DWORD flags,
    DWORD *identifier) {
  HANDLE thread;
  if (fixture_admission_terminal_mode) {
    DWORD call = ++fixture_terminal_thread_call;
    if (call == fixture_terminal_thread_failure) return NULL;
    thread = CreateThread(attributes, stack_bytes, routine, context, flags,
                          identifier);
    if (thread != NULL && context != NULL) {
      TERMINAL_WORKER *worker = (TERMINAL_WORKER *)context;
      fixture_terminal_thread_handles[worker->kind] = thread;
    }
    if (call == fixture_terminal_thread_zero_identifier && identifier != NULL)
      *identifier = 0U;
    return thread;
  }
  return CreateThread(attributes, stack_bytes, routine, context, flags,
                      identifier);
}

static DWORD WINAPI fixture_admission_ResumeThread(HANDLE thread) {
  if (!fixture_admission_terminal_mode) return ResumeThread(thread);
  fixture_admission_resume_count += 1U;
  return thread == ADMISSION_FIXTURE_THREAD ? fixture_admission_resume_result
                                             : 0xffffffffU;
}

static ULONGLONG WINAPI fixture_admission_GetTickCount64(void) {
  if (!fixture_admission_terminal_mode) return GetTickCount64();
  fixture_terminal_tick_call += 1U;
  if (fixture_terminal_tick_fault >= 2U &&
      fixture_terminal_tick_fault <= 4U) {
    if (fixture_terminal_tick_call == 1U) return 100U;
    if (fixture_terminal_tick_call == 2U)
      return fixture_terminal_tick_fault == 2U
                 ? 5100U
                 : (fixture_terminal_tick_fault == 3U ? 5099U : 5101U);
    return 5099U;
  }
  if (fixture_terminal_tick_fault == 5U) {
    if (fixture_terminal_tick_call == 1U) return 100U;
    if (fixture_terminal_tick_call < 10U)
      return 100U + fixture_terminal_tick_call;
    if (fixture_terminal_tick_call == 10U) return 5099U;
    return 5100U + fixture_terminal_tick_call - 11U;
  }
  if (fixture_terminal_tick_fault >= 6U &&
      fixture_terminal_tick_fault <= 8U) {
    if (fixture_terminal_tick_call == 1U) return 100U;
    if (fixture_terminal_tick_call < 10U)
      return 100U + fixture_terminal_tick_call;
    if (fixture_terminal_tick_call == 10U) return 5098U;
    if (fixture_terminal_tick_call == 11U) return 5099U;
    if (fixture_terminal_tick_call == 12U)
      return fixture_terminal_tick_fault == 6U
                 ? 5100U
                 : (fixture_terminal_tick_fault == 7U ? 5101U : 99U);
    return 5100U + fixture_terminal_tick_call - 12U;
  }
  if (fixture_terminal_tick_fault >= 9U &&
      fixture_terminal_tick_fault <= 10U) {
    if (fixture_terminal_tick_call == 1U) return 100U;
    if (fixture_terminal_tick_call == 2U) return 5099U;
    if (fixture_terminal_tick_call == 3U)
      return fixture_terminal_tick_fault == 9U ? 5100U : 5101U;
    return 5100U + fixture_terminal_tick_call - 3U;
  }
  if (fixture_terminal_tick_fault == 1U && fixture_terminal_tick_call == 2U &&
      fixture_admission_tick > 1U)
    return fixture_admission_tick - 2U;
  return fixture_admission_tick++;
}

static BOOL WINAPI fixture_admission_HeapFree(HANDLE heap, DWORD flags,
                                              LPVOID value) {
  BOOL result;
  for (DWORD index = 0U; index < 2U; index += 1U)
    if (fixture_admission_terminal_mode &&
        value == fixture_terminal_buffers[index]) {
      fixture_terminal_buffer_free_attempts[index] += 1U;
      if (fixture_terminal_buffer_free_failure == index + 1U ||
          fixture_terminal_buffer_free_failure == 3U)
        return FALSE;
    }
  result = HeapFree(heap, flags, value);
  if (fixture_admission_terminal_mode &&
      (value == fixture_terminal_buffers[0] ||
       value == fixture_terminal_buffers[1]))
    fixture_terminal_buffer_frees += 1U;
  if (fixture_admission_resource_kind == 1U && value != NULL) {
    fixture_admission_resource_call += 1U;
    if (fixture_admission_resource_call ==
        fixture_admission_resource_failure)
      return FALSE;
  }
  return result;
}

static LPVOID WINAPI fixture_admission_HeapAlloc(HANDLE heap, DWORD flags,
                                                 SIZE_T bytes) {
  LPVOID value;
  if (fixture_admission_track_allocations)
    fixture_admission_allocations += 1U;
  if (fixture_admission_terminal_mode && bytes == TERMINAL_STREAM_MAXIMUM) {
    DWORD call = ++fixture_terminal_allocation_call;
    if (call == fixture_terminal_allocation_failure) return NULL;
    value = HeapAlloc(heap, flags, bytes);
    if (call <= 2U) fixture_terminal_buffers[call - 1U] = value;
    return value;
  }
  return HeapAlloc(heap, flags, bytes);
}

static PVOID WINAPI fixture_admission_FreeSid(PSID sid) {
  PVOID result = FreeSid(sid);
  if (fixture_admission_resource_kind == 2U && sid != NULL) {
    fixture_admission_resource_call += 1U;
    if (fixture_admission_resource_call ==
        fixture_admission_resource_failure)
      return sid;
  }
  return result;
}

static DWORD WINAPI fixture_admission_GetModuleFileNameW(HANDLE module,
                                                         LPWSTR path,
                                                         DWORD capacity) {
  DWORD units = (DWORD)wide_length(fixture_admission_module_path);
  if (module != NULL || path == NULL || capacity <= units) return 0U;
  copy_bytes(path, fixture_admission_module_path, (units + 1U) * 2U);
  return units;
}

static int fixture_admission_plan_digest(
    ROOT_CUSTODY *root, const PROFILE_IDENTITY *identity,
    const EXECUTION_CUSTODY *execution, ADMISSION_CUSTODY *admission,
    ADMISSION_PLAN *plan) {
  (void)root;
  (void)identity;
  (void)execution;
  fixture_admission_order[fixture_admission_order_count++] = 85U;
  if (fixture_admission_component_failure == 8U) return 0;
  plan->grant_security = fixture_admission_grant;
  plan->grant_security_length = 4U;
  plan->job_security = fixture_admission_grant;
  plan->job_security_length = 4U;
  if (equal_bytes(admission->grant_digest, (BYTE[32]){0}, 32U))
    admission->grant_digest[0] = 1U;
  if (equal_bytes(admission->launch_digest, (BYTE[32]){0}, 32U))
    admission->launch_digest[0] = 2U;
  return 1;
}

static int fixture_admission_persist(ROOT_CUSTODY *root,
                                     PROFILE_IDENTITY *identity,
                                     ADMISSION_CUSTODY *admission, BYTE kind) {
  (void)root;
  (void)identity;
  fixture_admission_persisted[fixture_admission_persisted_count++] = kind;
  fixture_admission_order[fixture_admission_order_count++] =
      (BYTE)(60U + kind);
  if (fixture_terminal_order_mode)
    fixture_terminal_order[fixture_terminal_order_count++] =
        (BYTE)(60U + kind);
  if (kind == fixture_admission_persist_failure) return 0;
  admission->phase = kind;
  admission->prior_digest[0] = kind;
  return 1;
}

static int fixture_admission_phase_absent(ROOT_CUSTODY *root,
                                          const PROFILE_IDENTITY *identity,
                                          BYTE kind) {
  (void)root;
  (void)identity;
  (void)kind;
  return 1;
}

static int fixture_admission_apply(ROOT_CUSTODY *root,
                                   EXECUTION_CUSTODY *execution,
                                   const ADMISSION_PLAN *plan) {
  (void)root;
  (void)execution;
  (void)plan;
  return fixture_admission_component_failure != 1U;
}

static HANDLE fixture_admission_create_job(ROOT_CUSTODY *root,
                                           const ADMISSION_CUSTODY *admission,
                                           const ADMISSION_PLAN *plan) {
  (void)root;
  (void)admission;
  (void)plan;
  return fixture_admission_component_failure == 2U ? NULL :
                                                     ADMISSION_FIXTURE_JOB;
}

static int fixture_admission_create_suspended(
    ROOT_CUSTODY *root, const PROFILE_IDENTITY *identity,
    const ADMISSION_PLAN *plan, ADMISSION_RUNTIME *runtime) {
  (void)root;
  (void)identity;
  (void)plan;
  if (fixture_admission_component_failure == 3U) return 0;
  runtime->process.hProcess = ADMISSION_FIXTURE_PROCESS;
  runtime->process.hThread = ADMISSION_FIXTURE_THREAD;
  runtime->process.dwProcessId = 777U;
  return 1;
}

static int fixture_admission_prove(ROOT_CUSTODY *root,
                                   const PROFILE_IDENTITY *identity,
                                   EXECUTION_CUSTODY *execution,
                                   const ADMISSION_PLAN *plan,
                                   ADMISSION_RUNTIME *runtime) {
  (void)root;
  (void)identity;
  (void)execution;
  (void)plan;
  (void)runtime;
  return fixture_admission_component_failure != 4U;
}

static int fixture_admission_clear_pending(ROOT_CUSTODY *root,
                                           const PROFILE_IDENTITY *identity) {
  (void)root;
  (void)identity;
  fixture_admission_order[fixture_admission_order_count++] = 81U;
  if (fixture_terminal_order_mode)
    fixture_terminal_order[fixture_terminal_order_count++] = 81U;
  return fixture_admission_component_failure != 7U;
}

static int fixture_admission_cleanup_runtime(
    ROOT_CUSTODY *root, const ADMISSION_CUSTODY *admission,
    const ADMISSION_PLAN *plan, ADMISSION_RUNTIME *runtime) {
  (void)root;
  (void)admission;
  (void)plan;
  (void)runtime;
  fixture_admission_cleanup_count += 1U;
  if (fixture_admission_terminal_mode)
    fixture_admission_order[fixture_admission_order_count++] = 95U;
  if (fixture_terminal_order_mode)
    fixture_terminal_order[fixture_terminal_order_count++] = 95U;
  return fixture_admission_component_failure != 5U;
}

static int fixture_admission_restore(ROOT_CUSTODY *root,
                                     EXECUTION_CUSTODY *execution) {
  (void)root;
  (void)execution;
  fixture_admission_restore_count += 1U;
  if (fixture_admission_terminal_mode) {
    fixture_admission_order[fixture_admission_order_count++] = 96U;
    zero_bytes(fixture_admission_profiles, sizeof(fixture_admission_profiles));
  }
  if (fixture_terminal_order_mode)
    fixture_terminal_order[fixture_terminal_order_count++] = 96U;
  return fixture_admission_component_failure != 6U;
}

static int fixture_admission_release_plan(ROOT_CUSTODY *root,
                                          ADMISSION_PLAN *plan) {
  (void)root;
  fixture_admission_order[fixture_admission_order_count++] = 84U;
  if (fixture_terminal_order_mode)
    fixture_terminal_order[fixture_terminal_order_count++] = 84U;
  zero_bytes(plan, sizeof(*plan));
  return 1;
}

static int fixture_admission_census_profile(ROOT_CUSTODY *root,
                                            PROFILE_IDENTITY *identity,
                                            int expect_absent,
                                            int require_exact) {
  (void)root;
  (void)identity;
  fixture_admission_order[fixture_admission_order_count++] = 86U;
  return expect_absent == 0 && require_exact == 1;
}

static int fixture_admission_bind_folder(ROOT_CUSTODY *root,
                                         PROFILE_IDENTITY *identity,
                                         HANDLE *folder) {
  (void)root;
  (void)identity;
  fixture_admission_order[fixture_admission_order_count++] = 87U;
  *folder = (HANDLE)0x701U;
  return 1;
}

static int fixture_admission_recovery_execution(ROOT_CUSTODY *root,
                                                PROFILE_IDENTITY *identity,
                                                EXECUTION_CUSTODY *execution) {
  (void)root;
  (void)identity;
  (void)execution;
  fixture_admission_order[fixture_admission_order_count++] = 88U;
  return 1;
}

static int fixture_admission_recovery_descriptors(
    ROOT_CUSTODY *root, const EXECUTION_CUSTODY *execution,
    const ADMISSION_PLAN *plan, BYTE phase) {
  fixture_admission_order[fixture_admission_order_count++] = 89U;
  return admission_recovery_descriptor_state(root, execution, plan, phase);
}

static int fixture_admission_recovery_job(
    ROOT_CUSTODY *root, const ADMISSION_CUSTODY *admission,
    const ADMISSION_PLAN *plan, BYTE phase) {
  (void)root;
  (void)admission;
  (void)plan;
  fixture_admission_order[fixture_admission_order_count++] = 82U;
  return phase >= ADMISSION_GRANT_ATTEMPTED &&
         phase <= ADMISSION_REVOKE_ATTEMPTED;
}

static int fixture_admission_scratch_absent(
    ROOT_CUSTODY *root, const PROFILE_IDENTITY *identity) {
  (void)root;
  (void)identity;
  fixture_admission_order[fixture_admission_order_count++] = 83U;
  if (fixture_terminal_order_mode)
    fixture_terminal_order[fixture_terminal_order_count++] = 83U;
  return 1;
}

static BOOL WINAPI fixture_admission_OpenThreadToken(HANDLE thread,
                                                     DWORD access,
                                                     BOOL open_as_self,
                                                     HANDLE *token) {
  (void)thread;
  if (access != TOKEN_QUERY || open_as_self != TRUE || token == NULL)
    return FALSE;
  if (fixture_admission_token_fault == 19U) {
    *token = (HANDLE)0x506U;
    return TRUE;
  }
  SetLastError(ERROR_NO_TOKEN);
  return FALSE;
}

static void fixture_admission_objects(EXECUTION_CUSTODY *execution) {
  zero_bytes(execution, sizeof(*execution));
  fixture_admission_execution = execution;
  zero_bytes(fixture_admission_profiles, sizeof(fixture_admission_profiles));
  execution->root.handle = (HANDLE)0x201U;
  copy_bytes(execution->root.path, L"\\\\?\\C:\\fixture-root", 40U);
  execution->root.path_units = 19U;
  for (DWORD index = 0U; index < 4U; index += 1U) {
    fixture_admission_original[index][0] = (BYTE)(index + 1U);
    if (index == 0U) {
      execution->root.security = fixture_admission_original[index];
      execution->root.security_length = 4U;
    } else {
      BYTE role = (BYTE)(index - 1U);
      execution->targets[role].handle = (HANDLE)(SIZE_T)(0x201U + index);
      execution->targets[role].security = fixture_admission_original[index];
      execution->targets[role].security_length = 4U;
      execution->sources[role].handle = (HANDLE)(SIZE_T)(0x301U + role);
      execution->targets[role].path[0] = L'X';
      execution->targets[role].path[1] = L'\0';
      execution->sources[role].path[0] = L'S';
      execution->sources[role].path[1] = L'\0';
    }
  }
  execution->parent.handle = (HANDLE)0x401U;
  execution->parent.path[0] = L'P';
  execution->parent.path[1] = L'\0';
}

static int fixture_admission_recovery_matrix(void) {
  ROOT_CUSTODY *root = &fixture_admission_test_root;
  EXECUTION_CUSTODY *execution = &fixture_admission_test_execution;
  ADMISSION_PLAN *plan = &fixture_admission_test_plan;
  zero_bytes(root, sizeof(*root));
  zero_bytes(plan, sizeof(*plan));
  fixture_admission_objects(execution);
  module_custody.image.handle = (HANDLE)0x460U;
  module_custody.source.handle = (HANDLE)0x461U;
  module_custody.parent.handle = (HANDLE)0x462U;
  copy_bytes(module_custody.image.path, L"I", 4U);
  copy_bytes(module_custody.source.path, L"S", 4U);
  copy_bytes(module_custody.parent.path, L"P", 4U);
  plan->grant_security = fixture_admission_grant;
  plan->grant_security_length = 4U;
  for (BYTE phase = ADMISSION_GRANT_ATTEMPTED;
       phase <= ADMISSION_REVOKE_ATTEMPTED; phase += 1U) {
    for (DWORD mask = 0U; mask < 16U; mask += 1U) {
      for (DWORD index = 0U; index < 4U; index += 1U)
        fixture_admission_profiles[index] = (BYTE)((mask >> index) & 1U);
      if (!admission_recovery_descriptor_state(root, execution, plan,
                                               phase))
        return 0;
    }
    for (DWORD index = 0U; index < 4U; index += 1U) {
      zero_bytes(fixture_admission_profiles,
                 sizeof(fixture_admission_profiles));
      fixture_admission_profiles[index] = 2U;
      if (admission_recovery_descriptor_state(root, execution, plan,
                                              phase))
        return 0;
    }
  }
  return 1;
}

static int fixture_admission_grant_order(void) {
  ROOT_CUSTODY *root = &fixture_admission_test_root;
  EXECUTION_CUSTODY *execution = &fixture_admission_test_execution;
  ADMISSION_PLAN *plan = &fixture_admission_test_plan;
  static const BYTE grant_order[] = {90U, 11U, 12U, 13U, 10U,
                                     91U, 91U, 91U, 92U};
  static const BYTE restore_order[] = {20U, 21U, 22U, 23U, 90U};
  zero_bytes(root, sizeof(*root));
  zero_bytes(plan, sizeof(*plan));
  fixture_admission_objects(execution);
  plan->grant_security = fixture_admission_grant;
  plan->grant_security_length = 4U;
  fixture_admission_order_count = 0U;
  fixture_admission_call = 0U;
  fixture_admission_fail_call = 0U;
  if (!apply_admission_grant(root, execution, plan) ||
      fixture_admission_order_count != sizeof(grant_order) ||
      !equal_bytes(fixture_admission_order, grant_order,
                   sizeof(grant_order)))
    return 0;
  for (DWORD failure = 1U; failure <= 4U; failure += 1U) {
    zero_bytes(fixture_admission_profiles,
               sizeof(fixture_admission_profiles));
    fixture_admission_order_count = 0U;
    fixture_admission_call = 0U;
    fixture_admission_fail_call = failure;
    if (apply_admission_grant(root, execution, plan)) return 0;
  }
  fixture_admission_order_count = 0U;
  fixture_admission_call = 0U;
  fixture_admission_fail_call = 0U;
  if (!restore_admission_grant(root, execution) ||
      fixture_admission_order_count != sizeof(restore_order) ||
      !equal_bytes(fixture_admission_order, restore_order,
                   sizeof(restore_order)))
    return 0;
  for (DWORD failure = 1U; failure <= 4U; failure += 1U) {
    for (DWORD index = 0U; index < 4U; index += 1U)
      fixture_admission_profiles[index] = 1U;
    fixture_admission_order_count = 0U;
    fixture_admission_call = 0U;
    fixture_admission_fail_call = failure;
    if (restore_admission_grant(root, execution) ||
        fixture_admission_order_count != 4U ||
        !equal_bytes(fixture_admission_order, restore_order, 4U))
      return 0;
  }
  zero_bytes(fixture_admission_profiles,
             sizeof(fixture_admission_profiles));
  fixture_admission_fail_call = 0U;
  return 1;
}

static void fixture_admission_launch_reset(void) {
  fixture_admission_call = 0U;
  fixture_admission_attribute_mask = 0U;
  fixture_admission_pipe_count = 0U;
  fixture_admission_handle_clear_count = 0U;
  fixture_admission_attribute_deletes = 0U;
  fixture_admission_pipe_drains = 0U;
  zero_bytes(fixture_admission_pipe_reads,
             sizeof(fixture_admission_pipe_reads));
  zero_bytes(fixture_admission_pipe_writes,
             sizeof(fixture_admission_pipe_writes));
}

static int fixture_admission_launch_matrix(PROFILE_IDENTITY *identity) {
  ROOT_CUSTODY *root = &fixture_admission_test_root;
  ADMISSION_PLAN *plan = &fixture_admission_test_plan;
  ADMISSION_RUNTIME runtime;
  ADMISSION_CUSTODY admission;
  zero_bytes(root, sizeof(*root));
  zero_bytes(plan, sizeof(*plan));
  zero_bytes(&admission, sizeof(admission));
  copy_bytes(plan->application, L"X", 4U);
  copy_bytes(plan->command_line, L"\"X\"", 8U);
  copy_bytes(plan->cwd, L"Y", 4U);
  copy_bytes(plan->environment, L"A=B\0\0", 10U);
  plan->creation_flags = CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT |
                         CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW;
  plan->job_security = fixture_admission_grant;
  plan->job_security_length = 4U;
  copy_bytes(admission.job_name, L"Local\\orch6-job-launch", 46U);
  admission.job_name_units = 22U;
  fixture_admission_job_plan = plan;
  fixture_admission_job_identity = &admission;
  fixture_admission_identity = identity;
  fixture_admission_launch_plan = plan;
  zero_bytes(&runtime, sizeof(runtime));
  runtime.job = ADMISSION_FIXTURE_JOB;
  fixture_admission_fail_call = 0U;
  fixture_admission_launch_reset();
  fixture_admission_job_fault = 0U;
  fixture_admission_token_fault = 0U;
  fixture_admission_job_present = 1;
  fixture_admission_job_active = 1U;
  if (!create_suspended_admission(root, identity, plan, &runtime) ||
      runtime.process.hProcess != ADMISSION_FIXTURE_PROCESS ||
      runtime.process.hThread != ADMISSION_FIXTURE_THREAD ||
      fixture_admission_attribute_mask != 7U) {
    fixture_admission_matrix_stage = 91U;
    return 0;
  }
  if (!cleanup_admission_runtime(root, &admission, plan, &runtime) ||
      fixture_admission_job_present ||
      fixture_admission_attribute_deletes != 1U ||
      fixture_admission_pipe_drains != 2U) {
    fixture_admission_matrix_stage = 92U;
    return 0;
  }
  for (DWORD failure = 1U; failure <= 22U; failure += 1U) {
    root->resource_ambiguous = 0;
    zero_bytes(&runtime, sizeof(runtime));
    runtime.job = ADMISSION_FIXTURE_JOB;
    fixture_admission_fail_call = failure;
    fixture_admission_launch_reset();
    fixture_admission_job_present = 1;
    fixture_admission_job_active = 0U;
    if (create_suspended_admission(root, identity, plan, &runtime)) {
      fixture_admission_matrix_stage = 100U + failure;
      return 0;
    }
    if (runtime.process.hProcess != NULL)
      fixture_admission_job_active = 1U;
    {
      int cleanup = cleanup_admission_runtime(root, &admission, plan, &runtime);
      int expected_cleanup = failure < 14U || failure > 17U;
      if (cleanup != expected_cleanup || fixture_admission_job_present ||
          runtime.attributes != NULL || runtime.stdin_read != NULL ||
          runtime.stdin_write != NULL || runtime.stdout_read != NULL ||
          runtime.stdout_write != NULL || runtime.stderr_read != NULL ||
          runtime.stderr_write != NULL || runtime.sentinel != NULL ||
          runtime.process.hProcess != NULL ||
          runtime.process.hThread != NULL) {
      fixture_admission_matrix_stage = 130U + failure;
      return 0;
      }
    }
  }
  for (DWORD failure = 1U; failure <= 6U; failure += 1U) {
    root->resource_ambiguous = 0;
    zero_bytes(&runtime, sizeof(runtime));
    runtime.job = ADMISSION_FIXTURE_JOB;
    fixture_admission_fail_call = 0U;
    fixture_admission_launch_reset();
    fixture_admission_job_present = 1;
    fixture_admission_job_active = 1U;
    fixture_admission_resource_kind = 0U;
    if (!create_suspended_admission(root, identity, plan, &runtime)) return 0;
    fixture_admission_resource_kind = 3U;
    fixture_admission_resource_call = 0U;
    fixture_admission_resource_failure = failure;
    if (cleanup_admission_runtime(root, &admission, plan, &runtime) ||
        fixture_admission_resource_call != 6U)
      return 0;
  }
  root->resource_ambiguous = 0;
  zero_bytes(&runtime, sizeof(runtime));
  runtime.job = ADMISSION_FIXTURE_JOB;
  fixture_admission_fail_call = 0U;
  fixture_admission_launch_reset();
  fixture_admission_job_present = 1;
  fixture_admission_job_active = 1U;
  fixture_admission_resource_kind = 0U;
  if (!create_suspended_admission(root, identity, plan, &runtime)) return 0;
  fixture_admission_resource_kind = 1U;
  fixture_admission_resource_call = 0U;
  fixture_admission_resource_failure = 1U;
  if (cleanup_admission_runtime(root, &admission, plan, &runtime) ||
      runtime.attributes != NULL)
    return 0;
  root->resource_ambiguous = 0;
  zero_bytes(&runtime, sizeof(runtime));
  runtime.job = ADMISSION_FIXTURE_JOB;
  fixture_admission_fail_call = 0U;
  fixture_admission_launch_reset();
  fixture_admission_job_present = 1;
  fixture_admission_job_active = 1U;
  fixture_admission_resource_kind = 0U;
  if (!create_suspended_admission(root, identity, plan, &runtime)) return 0;
  fixture_admission_resource_kind = 4U;
  fixture_admission_resource_call = 0U;
  if (cleanup_admission_runtime(root, &admission, plan, &runtime) ||
      fixture_admission_resource_call != 6U)
    return 0;
  fixture_admission_resource_kind = 0U;
  fixture_admission_fail_call = 0U;
  return 1;
}

static int fixture_admission_expected_launch_digest(
    ROOT_CUSTODY *root, const PROFILE_IDENTITY *identity,
    const ADMISSION_CUSTODY *admission, const ADMISSION_PLAN *plan,
    BYTE digest[32]) {
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits;
  BYTE *material;
  DWORD cursor = 0U;
  DWORD command_units = (DWORD)wide_length(plan->command_line);
  DWORD length;
  zero_bytes(&limits, sizeof(limits));
  limits.BasicLimitInformation.LimitFlags =
      JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  length = (DWORD)ascii_length("op.windows-admission-launch/v1") + 1U +
           32U + 2U + (DWORD)admission->job_name_units * 2U + 4U +
           plan->job_security_length + 4U + sizeof(limits) + 4U +
           (DWORD)wide_length(plan->application) * 2U + 4U +
           command_units * 2U + 4U + (DWORD)wide_length(plan->cwd) * 2U +
           4U + plan->environment_units * 2U + 20U + 4U;
  material = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, length);
  if (material == NULL) return 0;
  copy_bytes(material + cursor, "op.windows-admission-launch/v1",
             ascii_length("op.windows-admission-launch/v1") + 1U);
  cursor += (DWORD)ascii_length("op.windows-admission-launch/v1") + 1U;
  copy_bytes(material + cursor, identity->token, 32U);
  cursor += 32U;
  write_u16(material + cursor, admission->job_name_units);
  cursor += 2U;
  copy_bytes(material + cursor, admission->job_name,
             (DWORD)admission->job_name_units * 2U);
  cursor += (DWORD)admission->job_name_units * 2U;
  write_u32(material + cursor, plan->job_security_length);
  cursor += 4U;
  copy_bytes(material + cursor, plan->job_security,
             plan->job_security_length);
  cursor += plan->job_security_length;
  write_u32(material + cursor, sizeof(limits));
  cursor += 4U;
  copy_bytes(material + cursor, &limits, sizeof(limits));
  cursor += sizeof(limits);
  {
    const WCHAR *values[3] = {
      plan->application, fixture_admission_expected_command, plan->cwd
    };
    for (DWORD index = 0U; index < 3U; index += 1U) {
      DWORD bytes = (DWORD)wide_length(values[index]) * 2U;
      write_u32(material + cursor, bytes);
      cursor += 4U;
      copy_bytes(material + cursor, values[index], bytes);
      cursor += bytes;
    }
  }
  write_u32(material + cursor, plan->environment_units * 2U);
  cursor += 4U;
  copy_bytes(material + cursor, fixture_admission_expected_environment,
             plan->environment_units * 2U);
  cursor += plan->environment_units * 2U;
  copy_bytes(material + cursor, "stdin\0stdout\0stderr", 20U);
  cursor += 20U;
  write_u32(material + cursor, plan->creation_flags);
  cursor += 4U;
  if (cursor != length || !sha256(material, length, digest,
                                  &root->resource_ambiguous)) {
    if (!HeapFree(GetProcessHeap(), 0U, material))
      root->resource_ambiguous = 1;
    return 0;
  }
  if (!HeapFree(GetProcessHeap(), 0U, material))
    root->resource_ambiguous = 1;
  return !root->resource_ambiguous;
}

static int fixture_admission_canonical_plan_matrix(
    PROFILE_IDENTITY *identity, PSID stable, DWORD stable_length) {
  ROOT_CUSTODY *root = &fixture_admission_test_root;
  EXECUTION_CUSTODY *execution = &fixture_admission_test_execution;
  ADMISSION_PLAN *plan = &fixture_admission_test_plan;
  ADMISSION_CUSTODY admission;
  ADMISSION_RUNTIME runtime;
  PSECURITY_DESCRIPTOR original = NULL;
  BYTE low_integrity[12];
  SID_IDENTIFIER_AUTHORITY mandatory = SECURITY_MANDATORY_LABEL_AUTHORITY;
  DWORD original_length = 0U;
  DWORD cursor = 0U;
  DWORD command_cursor = 0U;
  DWORD environment_cursor = 0U;
  WCHAR windows[PATH_MAX_UNITS + 1U];
  DWORD windows_units;
  BYTE expected_launch_digest[32];
  int valid = 0;
  static const WCHAR *target_names[] = {
    L"node.exe", L"rpc-runner.mjs", L"candidate.mjs"
  };
  fixture_admission_matrix_stage = 181U;
  zero_bytes(root, sizeof(*root));
  zero_bytes(plan, sizeof(*plan));
  zero_bytes(&admission, sizeof(admission));
  zero_bytes(&runtime, sizeof(runtime));
  fixture_admission_objects(execution);
  root->stable_sid = stable;
  root->stable_sid_length = stable_length;
  root->integrity_sid_length = fixture_admission_sid_bytes(
      low_integrity, mandatory, 1U, SECURITY_MANDATORY_LOW_RID, 0U);
  root->integrity_sid = low_integrity;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
          L"O:SYG:SYD:P(A;;FA;;;SY)S:(ML;;NW;;;LW)", SDDL_REVISION_1,
          &original, &original_length) || original == NULL ||
      original_length == 0U)
    goto done;
  fixture_admission_matrix_stage = 182U;
  cursor = 0U;
  if (!append_wide(identity->folder, PATH_MAX_UNITS + 1U, &cursor,
                   L"\\\\?\\C:\\fixture-profile"))
    goto done;
  identity->folder_units = (WORD)cursor;
  cursor = 0U;
  if (!append_wide(execution->parent.path, PATH_MAX_UNITS + 1U, &cursor,
                   L"\\\\?\\C:\\fixture-parent"))
    goto done;
  execution->parent.path_units = (WORD)cursor;
  cursor = 0U;
  if (!append_wide(execution->root.path, PATH_MAX_UNITS + 1U, &cursor,
                   L"\\\\?\\C:\\fixture-parent\\orch6-execution-") ||
      !append_wide(execution->root.path, PATH_MAX_UNITS + 1U, &cursor,
                   L"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"))
    goto done;
  execution->root.path_units = (WORD)cursor;
  execution->parent.security = original;
  execution->parent.security_length = original_length;
  execution->root.security = original;
  execution->root.security_length = original_length;
  for (BYTE role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U) {
    cursor = 0U;
    if (!append_wide(execution->targets[role].path,
                     PATH_MAX_UNITS + 1U, &cursor,
                     execution->root.path) ||
        !append_wide(execution->targets[role].path,
                     PATH_MAX_UNITS + 1U, &cursor, L"\\") ||
        !append_wide(execution->targets[role].path,
                     PATH_MAX_UNITS + 1U, &cursor, target_names[role]))
      goto done;
    execution->targets[role].path_units = (WORD)cursor;
    execution->targets[role].security = original;
    execution->targets[role].security_length = original_length;
  }
  fixture_admission_matrix_stage = 183U;
  if (!admission_plan_digest(root, identity, execution, &admission, plan) ||
      equal_bytes(admission.grant_digest, (BYTE[32]){0}, 32U) ||
      equal_bytes(admission.launch_digest, (BYTE[32]){0}, 32U) ||
      plan->creation_flags !=
          (CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT |
           CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW))
    goto done;
  zero_bytes(fixture_admission_expected_command,
             sizeof(fixture_admission_expected_command));
  if (!append_wide(fixture_admission_expected_command, 4096U,
                   &command_cursor, L"\"") ||
      !append_wide(fixture_admission_expected_command, 4096U,
                   &command_cursor, execution->targets[0].path) ||
      !append_wide(fixture_admission_expected_command, 4096U,
                   &command_cursor,
                   L"\" \"--preserve-symlinks\" \"--preserve-symlinks-main") ||
      !append_wide(fixture_admission_expected_command, 4096U,
                   &command_cursor, L"\" \"") ||
      !append_wide(fixture_admission_expected_command, 4096U,
                   &command_cursor, execution->targets[1].path) ||
      !append_wide(fixture_admission_expected_command, 4096U,
                   &command_cursor, L"\" \"") ||
      !append_wide(
          fixture_admission_expected_command, 4096U, &command_cursor,
          L"file:///C:/fixture-parent/orch6-execution-0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20/candidate.mjs") ||
      !append_wide(fixture_admission_expected_command, 4096U,
                   &command_cursor, L"\"") ||
      !wide_equal(plan->application, execution->targets[0].path) ||
      !wide_equal(plan->command_line,
                  fixture_admission_expected_command) ||
      !wide_equal(plan->cwd, identity->folder))
    goto done;
  zero_bytes(fixture_admission_expected_environment,
             sizeof(fixture_admission_expected_environment));
  windows_units = GetWindowsDirectoryW(windows, PATH_MAX_UNITS + 1U);
  if (windows_units == 0U || windows_units > PATH_MAX_UNITS ||
      !fixture_admission_expected_environment_add(
          &environment_cursor, L"LOCALAPPDATA", identity->folder) ||
      !fixture_admission_expected_environment_add(
          &environment_cursor, L"SystemRoot", windows) ||
      !fixture_admission_expected_environment_add(
          &environment_cursor, L"TEMP", identity->folder) ||
      !fixture_admission_expected_environment_add(
          &environment_cursor, L"TMP", identity->folder) ||
      !fixture_admission_expected_environment_add(
          &environment_cursor, L"WINDIR", windows) ||
      plan->environment_units != environment_cursor + 1U ||
      !equal_bytes(plan->environment,
                   fixture_admission_expected_environment,
                   plan->environment_units * 2U))
    goto done;
  if (!fixture_admission_expected_launch_digest(
          root, identity, &admission, plan, expected_launch_digest) ||
      !equal_bytes(expected_launch_digest, admission.launch_digest, 32U))
    goto done;
  fixture_admission_matrix_stage = 184U;
  fixture_admission_identity = identity;
  fixture_admission_launch_plan = plan;
  fixture_admission_job_plan = plan;
  fixture_admission_job_identity = &admission;
  fixture_admission_fail_call = 0U;
  fixture_admission_launch_reset();
  fixture_admission_job_fault = 0U;
  fixture_admission_token_fault = 0U;
  fixture_admission_job_present = 1;
  fixture_admission_job_active = 1U;
  runtime.job = ADMISSION_FIXTURE_JOB;
  if (!create_suspended_admission(root, identity, plan, &runtime) ||
      !cleanup_admission_runtime(root, &admission, plan, &runtime) ||
      fixture_admission_attribute_deletes != 1U ||
      fixture_admission_pipe_drains != 2U)
    goto done;
  fixture_admission_matrix_stage = 185U;
  valid = 1;
done:
  if (plan->grant_security != NULL || plan->job_security != NULL)
    if (!release_admission_plan(root, plan)) valid = 0;
  if (original != NULL && LocalFree(original) != NULL) valid = 0;
  return valid;
}

static int fixture_admission_token_once(ROOT_CUSTODY *root,
                                        PROFILE_IDENTITY *identity,
                                        EXECUTION_CUSTODY *execution,
                                        ADMISSION_PLAN *plan, DWORD fault,
                                        DWORD access_failure,
                                        DWORD open_failure) {
  ADMISSION_RUNTIME runtime;
  zero_bytes(&runtime, sizeof(runtime));
  runtime.job = ADMISSION_FIXTURE_JOB;
  runtime.process.hProcess = ADMISSION_FIXTURE_PROCESS;
  runtime.process.dwProcessId = 777U;
  fixture_admission_root = root;
  fixture_admission_identity = identity;
  fixture_admission_token_fault = fault;
  fixture_admission_access_count = 0U;
  fixture_admission_open_count = 0U;
  fixture_admission_access_fail = access_failure;
  fixture_admission_open_fail = open_failure;
  fixture_admission_impersonating = 0;
  return prove_child_token(root, identity, execution, plan, &runtime);
}

static int fixture_admission_token_matrix(PROFILE_IDENTITY *identity,
                                          PSID stable, DWORD stable_length) {
  ROOT_CUSTODY *root = &fixture_admission_test_root;
  EXECUTION_CUSTODY *execution = &fixture_admission_test_execution;
  ADMISSION_PLAN *plan = &fixture_admission_test_plan;
  static const TOKEN_INFORMATION_CLASS variable_kinds[] = {
    TokenUser, TokenAppContainerSid, TokenIntegrityLevel,
    TokenCapabilities, TokenGroups
  };
  zero_bytes(root, sizeof(*root));
  zero_bytes(plan, sizeof(*plan));
  root->stable_sid = stable;
  root->stable_sid_length = stable_length;
  root->handle = (HANDLE)0x450U;
  copy_bytes(root->path, L"R", 4U);
  fixture_admission_objects(execution);
  fixture_admission_query_fault = 0U;
  fixture_admission_resource_kind = 0U;
  if (!fixture_admission_token_once(root, identity, execution, plan, 0U,
                                    0U, 0U) ||
      fixture_admission_access_count != 56U ||
      fixture_admission_open_count != 59U ||
      fixture_admission_impersonating)
    return 0;
  for (DWORD fault = 1U; fault <= 41U; fault += 1U) {
    if (fault == 14U || fault == 16U) continue;
    root->resource_ambiguous = 0;
    if (fixture_admission_token_once(root, identity, execution, plan,
                                     fault, 0U, 0U))
      return 0;
  }
  for (DWORD failure = 1U; failure <= 56U; failure += 1U) {
    root->resource_ambiguous = 0;
    if (fixture_admission_token_once(root, identity, execution, plan, 0U,
                                     failure, 0U))
      return 0;
  }
  for (DWORD failure = 1U; failure <= 59U; failure += 1U) {
    root->resource_ambiguous = 0;
    if (fixture_admission_token_once(root, identity, execution, plan, 0U,
                                     0U, failure))
      return 0;
  }
  for (DWORD kind = 0U;
       kind < sizeof(variable_kinds) / sizeof(variable_kinds[0]);
       kind += 1U) {
    for (DWORD fault = 1U; fault <= 5U; fault += 1U) {
      root->resource_ambiguous = 0;
      fixture_admission_query_kind = variable_kinds[kind];
      fixture_admission_query_fault = fault;
      if (fixture_admission_token_once(root, identity, execution, plan, 0U,
                                       0U, 0U))
        return 0;
    }
    for (DWORD fault = 1U; fault <= 3U; fault += 1U) {
      BYTE *buffer = NULL;
      DWORD length = 0U;
      fixture_admission_query_kind = variable_kinds[kind];
      fixture_admission_query_fault = fault;
      fixture_admission_track_allocations = 1;
      fixture_admission_allocations = 0U;
      if (query_token_buffer(root, ADMISSION_FIXTURE_PROCESS_TOKEN,
                             variable_kinds[kind], &buffer, &length) ||
          buffer != NULL || fixture_admission_allocations != 0U)
        return 0;
      fixture_admission_track_allocations = 0;
    }
  }
  fixture_admission_query_fault = 0U;
  for (DWORD failure = 1U; failure <= 5U; failure += 1U) {
    root->resource_ambiguous = 0;
    fixture_admission_resource_kind = 1U;
    fixture_admission_resource_call = 0U;
    fixture_admission_resource_failure = failure;
    if (fixture_admission_token_once(root, identity, execution, plan, 0U,
                                     0U, 0U))
      return 0;
  }
  for (DWORD failure = 1U; failure <= 3U; failure += 1U) {
    root->resource_ambiguous = 0;
    fixture_admission_resource_kind = 2U;
    fixture_admission_resource_call = 0U;
    fixture_admission_resource_failure = failure;
    if (fixture_admission_token_once(root, identity, execution, plan, 0U,
                                     0U, 0U))
      return 0;
  }
  fixture_admission_resource_kind = 0U;
  return 1;
}

static int fixture_admission_job_matrix(void) {
  ROOT_CUSTODY *root = &fixture_admission_test_root;
  ADMISSION_PLAN *plan = &fixture_admission_test_plan;
  ADMISSION_CUSTODY admission;
  HANDLE job;
  zero_bytes(root, sizeof(*root));
  zero_bytes(plan, sizeof(*plan));
  zero_bytes(&admission, sizeof(admission));
  copy_bytes(admission.job_name, L"Local\\orch6-job-fixture", 48U);
  admission.job_name_units = 23U;
  plan->job_security = fixture_admission_grant;
  plan->job_security_length = 4U;
  fixture_admission_job_plan = plan;
  fixture_admission_job_identity = &admission;
  fixture_admission_fail_call = 0U;
  fixture_admission_call = 0U;
  fixture_admission_token_fault = 0U;
  fixture_admission_job_fault = 0U;
  fixture_admission_job_present = 0;
  fixture_admission_job_active = 0U;
  job = create_admission_job(root, &admission, plan);
  if (job != ADMISSION_FIXTURE_JOB) return 0;
  fixture_admission_job_active = 1U;
  if (!verify_admission_job(root, job, plan, 1U, 777U)) return 0;
  for (DWORD fault = 1U; fault <= 18U; fault += 1U) {
    root->resource_ambiguous = 0;
    fixture_admission_job_fault = fault;
    if (verify_admission_job(root, job, plan, 1U, 777U)) return 0;
  }
  for (DWORD fault = 24U; fault <= 26U; fault += 1U) {
    fixture_admission_job_fault = fault;
    fixture_admission_job_present = 1;
    fixture_admission_job_active = 1U;
    job = ADMISSION_FIXTURE_JOB;
    if (terminate_admission_job(root, &job, &admission, plan)) return 0;
    root->resource_ambiguous = 0;
  }
  fixture_admission_job_fault = 0U;
  fixture_admission_job_present = 1;
  fixture_admission_job_active = 1U;
  job = ADMISSION_FIXTURE_JOB;
  if (!terminate_admission_job(root, &job, &admission, plan) ||
      job != NULL || fixture_admission_job_present)
    return 0;
  for (DWORD fault = 20U; fault <= 23U; fault += 1U) {
    root->resource_ambiguous = 0;
    fixture_admission_job_fault = fault;
    fixture_admission_job_present = fault == 20U;
    fixture_admission_token_fault = 0U;
    job = create_admission_job(root, &admission, plan);
    if (job != NULL) return 0;
    fixture_admission_job_present = 0;
  }
  fixture_admission_job_fault = 0U;
  fixture_admission_token_fault = 12U;
  if (create_admission_job(root, &admission, plan) != NULL) return 0;
  fixture_admission_token_fault = 0U;
  fixture_admission_job_present = 0;
  return 1;
}

static void fixture_admission_orchestration_reset(void) {
  fixture_admission_persisted_count = 0U;
  fixture_admission_persist_failure = 0U;
  fixture_admission_component_failure = 0U;
  fixture_admission_cleanup_count = 0U;
  fixture_admission_restore_count = 0U;
  fixture_admission_order_count = 0U;
  fixture_admission_call = 0U;
  fixture_admission_fail_call = 0U;
}

static int fixture_admission_lifecycle_matrix(PROFILE_IDENTITY *identity) {
  ROOT_CUSTODY *root = &fixture_admission_test_root;
  EXECUTION_CUSTODY *execution = &fixture_admission_test_execution;
  typedef struct fixture_lifecycle_case {
    DWORD failure;
    int outcome;
    BYTE count;
    BYTE phases[7];
    DWORD cleanup;
    DWORD restore;
  } FIXTURE_LIFECYCLE_CASE;
  static const BYTE success[] = {
    ADMISSION_GRANT_ATTEMPTED, ADMISSION_GRANTED,
    ADMISSION_JOB_ATTEMPTED, ADMISSION_LAUNCH_ATTEMPTED,
    ADMISSION_PROVED, ADMISSION_REVOKE_ATTEMPTED,
    ADMISSION_ABSENCE_PROVED
  };
  static const FIXTURE_LIFECYCLE_CASE component_cases[] = {
    {1U, 0, 3U, {1U, 6U, 7U}, 1U, 1U},
    {2U, 0, 5U, {1U, 2U, 3U, 6U, 7U}, 1U, 1U},
    {3U, 0, 6U, {1U, 2U, 3U, 4U, 6U, 7U}, 1U, 1U},
    {4U, 0, 6U, {1U, 2U, 3U, 4U, 6U, 7U}, 1U, 1U},
    {5U, -1, 6U, {1U, 2U, 3U, 4U, 5U, 6U}, 1U, 1U},
    {6U, -1, 6U, {1U, 2U, 3U, 4U, 5U, 6U}, 1U, 1U},
    {7U, -1, 5U, {1U, 2U, 3U, 4U, 5U}, 1U, 1U},
    {8U, 0, 0U, {0U}, 0U, 0U}
  };
  static const FIXTURE_LIFECYCLE_CASE persist_cases[] = {
    {1U, 0, 1U, {1U}, 0U, 0U},
    {2U, -1, 2U, {1U, 2U}, 1U, 1U},
    {3U, -1, 3U, {1U, 2U, 3U}, 1U, 1U},
    {4U, -1, 4U, {1U, 2U, 3U, 4U}, 1U, 1U},
    {5U, -1, 5U, {1U, 2U, 3U, 4U, 5U}, 1U, 1U},
    {6U, -1, 6U, {1U, 2U, 3U, 4U, 5U, 6U}, 1U, 1U},
    {7U, -1, 7U, {1U, 2U, 3U, 4U, 5U, 6U, 7U}, 1U, 1U}
  };
  zero_bytes(root, sizeof(*root));
  fixture_admission_objects(execution);
  execution->phase = EXECUTION_CREATED;
  execution->profile_created_digest[0] = 1U;
  execution->prior_digest[0] = 2U;
  fixture_admission_orchestration_reset();
  {
    int outcome = run_admission_lifecycle(root, identity, execution);
    if (outcome != 1) {
      fixture_admission_matrix_stage =
          outcome == 0 ? 80U + fixture_admission_persisted_count : 30U;
      return 0;
    }
  }
  if (fixture_admission_persisted_count != sizeof(success)) {
    fixture_admission_matrix_stage = 32U;
    return 0;
  }
  if (!equal_bytes(fixture_admission_persisted, success, sizeof(success))) {
    fixture_admission_matrix_stage = 33U;
    return 0;
  }
  if (fixture_admission_cleanup_count != 1U) {
    fixture_admission_matrix_stage = 34U;
    return 0;
  }
  if (fixture_admission_restore_count != 1U) {
    fixture_admission_matrix_stage = 35U;
    return 0;
  }
  for (DWORD index = 0U;
       index < sizeof(component_cases) / sizeof(component_cases[0]);
       index += 1U) {
    const FIXTURE_LIFECYCLE_CASE *test_case = &component_cases[index];
    int outcome;
    fixture_admission_orchestration_reset();
    fixture_admission_component_failure = test_case->failure;
    outcome = run_admission_lifecycle(root, identity, execution);
    if (outcome != test_case->outcome ||
        fixture_admission_persisted_count != test_case->count ||
        !equal_bytes(fixture_admission_persisted, test_case->phases,
                     test_case->count) ||
        fixture_admission_cleanup_count != test_case->cleanup ||
        fixture_admission_restore_count != test_case->restore) {
      fixture_admission_matrix_stage = 40U + test_case->failure;
      return 0;
    }
  }
  for (DWORD index = 0U;
       index < sizeof(persist_cases) / sizeof(persist_cases[0]);
       index += 1U) {
    const FIXTURE_LIFECYCLE_CASE *test_case = &persist_cases[index];
    int outcome;
    fixture_admission_orchestration_reset();
    fixture_admission_persist_failure = (BYTE)test_case->failure;
    outcome = run_admission_lifecycle(root, identity, execution);
    if (outcome != test_case->outcome ||
        fixture_admission_persisted_count != test_case->count ||
        !equal_bytes(fixture_admission_persisted, test_case->phases,
                     test_case->count) ||
        fixture_admission_cleanup_count != test_case->cleanup ||
        fixture_admission_restore_count != test_case->restore) {
      fixture_admission_matrix_stage = 60U + test_case->failure;
      return 0;
    }
  }
  return 1;
}

static int fixture_admission_outer_recovery_matrix(
    PROFILE_IDENTITY *identity) {
  ROOT_CUSTODY *root = &fixture_admission_test_root;
  EXECUTION_CUSTODY *execution = &fixture_admission_test_execution;
  JOURNAL_GROUP group;
  static const BYTE recovery_order[] = {
    86U, 87U, 88U, 85U, 89U, 82U, 81U, 66U, 20U, 21U, 22U,
    23U, 91U, 92U, 91U, 91U, 91U, 83U, 81U, 67U, 84U
  };
  static const BYTE durable_recovery_order[] = {
    86U, 87U, 88U, 85U, 89U, 82U, 81U, 20U, 21U, 22U,
    23U, 91U, 92U, 91U, 91U, 91U, 83U, 81U, 67U, 84U
  };
  zero_bytes(root, sizeof(*root));
  fixture_admission_objects(execution);
  execution->phase = EXECUTION_CREATED;
  for (BYTE phase = ADMISSION_GRANT_ATTEMPTED;
       phase <= ADMISSION_REVOKE_ATTEMPTED; phase += 1U) {
    zero_bytes(&group, sizeof(group));
    copy_bytes(&group.identity, identity, sizeof(*identity));
    group.execution = execution;
    group.admission.phase = phase;
    group.admission.grant_digest[0] = 1U;
    group.admission.launch_digest[0] = 2U;
    for (DWORD index = 0U; index < 4U; index += 1U)
      fixture_admission_profiles[index] = (BYTE)((index + phase) & 1U);
    fixture_admission_orchestration_reset();
    if (!recover_admission(root, &group) ||
        fixture_admission_persisted_count != (phase == 6U ? 1U : 2U) ||
        fixture_admission_persisted[fixture_admission_persisted_count - 1U] !=
            ADMISSION_ABSENCE_PROVED ||
        fixture_admission_order_count !=
            (phase == 6U ? sizeof(durable_recovery_order) :
                           sizeof(recovery_order)) ||
        !equal_bytes(fixture_admission_order,
                     phase == 6U ? durable_recovery_order : recovery_order,
                     phase == 6U ? sizeof(durable_recovery_order) :
                                    sizeof(recovery_order)))
      return 0;
  }
  zero_bytes(&group, sizeof(group));
  copy_bytes(&group.identity, identity, sizeof(*identity));
  group.execution = execution;
  group.admission.phase = ADMISSION_PROVED;
  group.admission.grant_digest[0] = 1U;
  group.admission.launch_digest[0] = 2U;
  zero_bytes(fixture_admission_profiles, sizeof(fixture_admission_profiles));
  fixture_admission_orchestration_reset();
  fixture_admission_persist_failure = ADMISSION_REVOKE_ATTEMPTED;
  if (recover_admission(root, &group)) return 0;
  fixture_admission_orchestration_reset();
  if (!recover_admission(root, &group) ||
      fixture_admission_persisted_count != 2U ||
      fixture_admission_persisted[0] != ADMISSION_REVOKE_ATTEMPTED ||
      fixture_admission_persisted[1] != ADMISSION_ABSENCE_PROVED)
    return 0;
  group.admission.phase = ADMISSION_REVOKE_ATTEMPTED;
  fixture_admission_orchestration_reset();
  fixture_admission_persist_failure = ADMISSION_ABSENCE_PROVED;
  if (recover_admission(root, &group)) return 0;
  fixture_admission_orchestration_reset();
  if (!recover_admission(root, &group) ||
      fixture_admission_persisted_count != 1U ||
      fixture_admission_persisted[0] != ADMISSION_ABSENCE_PROVED)
    return 0;
  return 1;
}

static void fixture_terminal_fault_reset(void) {
  fixture_admission_terminal_mode = 1;
  fixture_admission_order_count = 0U;
  fixture_terminal_allocation_call = 0U;
  fixture_terminal_allocation_failure = 0U;
  fixture_terminal_thread_call = 0U;
  fixture_terminal_thread_failure = 0U;
  fixture_terminal_thread_zero_identifier = 0U;
  zero_bytes(fixture_terminal_thread_handles,
             sizeof(fixture_terminal_thread_handles));
  fixture_terminal_wait_failure_kind = 0U;
  fixture_terminal_write_fault = 0U;
  zero_bytes(fixture_terminal_read_fault, sizeof(fixture_terminal_read_fault));
  zero_bytes(fixture_terminal_read_total, sizeof(fixture_terminal_read_total));
  zero_bytes(fixture_terminal_pipe_handles,
             sizeof(fixture_terminal_pipe_handles));
  zero_bytes(fixture_terminal_buffers, sizeof(fixture_terminal_buffers));
  fixture_terminal_buffer_frees = 0U;
  fixture_terminal_tick_fault = 0U;
  fixture_terminal_tick_call = 0U;
  fixture_terminal_response_handle = NULL;
  fixture_terminal_response_fault = 0U;
  fixture_terminal_close_fault = fixture_terminal_requested_close_fault;
  fixture_terminal_close_case = fixture_terminal_requested_close_fault;
  zero_bytes(fixture_terminal_pipe_close_calls,
             sizeof(fixture_terminal_pipe_close_calls));
  zero_bytes(fixture_terminal_thread_close_calls,
             sizeof(fixture_terminal_thread_close_calls));
  fixture_terminal_buffer_free_failure =
      fixture_terminal_requested_buffer_free_failure;
  fixture_terminal_requested_close_fault = 0U;
  fixture_terminal_requested_buffer_free_failure = 0U;
  zero_bytes(fixture_terminal_buffer_free_attempts,
             sizeof(fixture_terminal_buffer_free_attempts));
  fixture_admission_persisted_count = 0U;
  fixture_admission_cleanup_count = 0U;
  fixture_admission_restore_count = 0U;
  fixture_admission_terminal_timeout = 0;
  fixture_admission_terminal_killed = 0;
  fixture_admission_terminal_exit_code = 0U;
  fixture_admission_resume_result = 1U;
  fixture_admission_resume_count = 0U;
  fixture_admission_tick = 100U;
  fixture_admission_job_fault = 0U;
  fixture_admission_job_present = 1;
  fixture_admission_job_active = 0U;
  fixture_admission_resource_kind = 0U;
  fixture_admission_resource_call = 0U;
  fixture_admission_resource_failure = 0U;
}

static int fixture_terminal_prepare(ACTIVE_ADMISSION *active,
                                    ADMISSION_PLAN *plan,
                                    HANDLE *child_stdin,
                                    HANDLE *child_stdout,
                                    HANDLE *child_stderr) {
  zero_bytes(active, sizeof(*active));
  zero_bytes(plan, sizeof(*plan));
  plan->job_security = fixture_admission_grant;
  plan->job_security_length = sizeof(fixture_admission_grant);
  active->plan = plan;
  active->opened = 1U;
  active->runtime.job = ADMISSION_FIXTURE_JOB;
  active->runtime.process.hProcess = ADMISSION_FIXTURE_PROCESS;
  active->runtime.process.hThread = ADMISSION_FIXTURE_THREAD;
  active->runtime.process.dwProcessId = 777U;
  fixture_admission_job_plan = plan;
  fixture_admission_job_identity = &active->custody;
  if (!CreatePipe(child_stdin, &active->runtime.stdin_write, NULL, 0U) ||
      !CreatePipe(&active->runtime.stdout_read, child_stdout, NULL, 0U) ||
      !CreatePipe(&active->runtime.stderr_read, child_stderr, NULL, 0U))
    return 0;
  fixture_terminal_pipe_handles[TERMINAL_WORKER_STDIN] =
      active->runtime.stdin_write;
  fixture_terminal_pipe_handles[TERMINAL_WORKER_STDOUT] =
      active->runtime.stdout_read;
  fixture_terminal_pipe_handles[TERMINAL_WORKER_STDERR] =
      active->runtime.stderr_read;
  return 1;
}

static int fixture_terminal_fault_case(
    DWORD allocation_failure, DWORD thread_failure,
    DWORD zero_identifier, DWORD resume_result, DWORD write_fault,
    DWORD stdout_fault, DWORD stderr_fault, DWORD wait_failure_kind,
    DWORD job_fault, DWORD tick_fault, const BYTE *challenge,
    DWORD challenge_length, int expected_result, BYTE expected_hard_abort,
    DWORD expected_buffer_frees) {
  static ROOT_CUSTODY root;
  static ACTIVE_ADMISSION active;
  static ADMISSION_PLAN plan;
  static TERMINAL_OBSERVATION observation;
  HANDLE child_stdin = NULL;
  HANDLE child_stdout = NULL;
  HANDLE child_stderr = NULL;
  int result;
  int valid;
  zero_bytes(&root, sizeof(root));
  zero_bytes(&observation, sizeof(observation));
  fixture_terminal_fault_reset();
  fixture_terminal_allocation_failure = allocation_failure;
  fixture_terminal_thread_failure = thread_failure;
  fixture_terminal_thread_zero_identifier = zero_identifier;
  fixture_admission_resume_result = resume_result;
  fixture_terminal_write_fault = write_fault;
  fixture_terminal_read_fault[0] = stdout_fault;
  fixture_terminal_read_fault[1] = stderr_fault;
  fixture_terminal_wait_failure_kind = wait_failure_kind;
  fixture_admission_job_fault = job_fault;
  fixture_terminal_tick_fault = tick_fault;
  if (!fixture_terminal_prepare(&active, &plan, &child_stdin, &child_stdout,
                                &child_stderr))
    return 0;
  if (stdout_fault == 1U) {
    static const BYTE bytes[] = {1U, 2U, 3U};
    DWORD written = 0U;
    if (!WriteFile(child_stdout, bytes, sizeof(bytes), &written, NULL) ||
        written != sizeof(bytes))
      return 0;
  }
  if (stdout_fault == 6U) {
    static const BYTE byte = 7U;
    DWORD written = 0U;
    if (!WriteFile(child_stdout, &byte, 1U, &written, NULL) || written != 1U)
      return 0;
  }
  if (stderr_fault == 1U) {
    static const BYTE bytes[] = {4U, 5U, 6U};
    DWORD written = 0U;
    if (!WriteFile(child_stderr, bytes, sizeof(bytes), &written, NULL) ||
        written != sizeof(bytes))
      return 0;
  }
  if (stderr_fault == 6U) {
    static const BYTE byte = 8U;
    DWORD written = 0U;
    if (!WriteFile(child_stderr, &byte, 1U, &written, NULL) || written != 1U)
      return 0;
  }
  if (!CloseHandle(child_stdout) || !CloseHandle(child_stderr)) return 0;
  child_stdout = NULL;
  child_stderr = NULL;
  result = run_active_terminal(&root, &active, challenge, challenge_length,
                               &observation);
  if (!CloseHandle(child_stdin)) return 0;
  child_stdin = NULL;
  valid = result == expected_result &&
          active.hard_abort == expected_hard_abort &&
          fixture_terminal_buffer_frees == expected_buffer_frees &&
          (!!root.resource_ambiguous == !!expected_hard_abort);
  if (fixture_terminal_close_case != 0U) {
    DWORD selected;
    int pipe_case = fixture_terminal_close_case <= 6U;
    int transient = fixture_terminal_close_case <= 3U ||
                    (fixture_terminal_close_case >= 7U &&
                     fixture_terminal_close_case <= 9U);
    selected = pipe_case ? (fixture_terminal_close_case - 1U) % 3U
                         : (fixture_terminal_close_case - 7U) % 3U;
    for (DWORD index = 0U; index < TERMINAL_WORKER_COUNT; index += 1U) {
      DWORD expected_pipe_calls =
          pipe_case && index == selected ? (transient ? 2U : 3U) : 1U;
      DWORD expected_thread_calls =
          !pipe_case && index == selected ? 2U : 1U;
      valid = valid &&
              fixture_terminal_pipe_close_calls[index] ==
                  expected_pipe_calls &&
              fixture_terminal_thread_close_calls[index] ==
                  expected_thread_calls;
      if (!expected_hard_abort || index != selected) {
        valid = valid && active.workers[index].pipe == NULL &&
                active.workers[index].thread == NULL;
      } else if (pipe_case) {
        valid = valid && active.workers[index].pipe != NULL &&
                active.workers[index].thread == NULL;
      } else {
        valid = valid && active.workers[index].pipe == NULL &&
                active.workers[index].thread != NULL;
      }
    }
    valid = valid && active.runtime.stdin_write == NULL &&
            active.runtime.stdout_read == NULL &&
            active.runtime.stderr_read == NULL;
  }
  if (fixture_terminal_buffer_free_failure != 0U)
    valid = valid && fixture_terminal_buffer_free_attempts[0] == 1U &&
            fixture_terminal_buffer_free_attempts[1] == 1U &&
            (fixture_terminal_buffer_free_failure == 2U
                 ? active.workers[TERMINAL_WORKER_STDOUT].output == NULL
                 : active.workers[TERMINAL_WORKER_STDOUT].output ==
                       fixture_terminal_buffers[0]) &&
            (fixture_terminal_buffer_free_failure == 1U
                 ? active.workers[TERMINAL_WORKER_STDERR].output == NULL
                 : active.workers[TERMINAL_WORKER_STDERR].output ==
                       fixture_terminal_buffers[1]);
  if (expected_hard_abort)
    valid = valid && fixture_admission_persisted_count == 0U &&
            fixture_admission_cleanup_count == 0U &&
            fixture_admission_restore_count == 0U;
  if (result == 1 && stdout_fault == 1U)
    valid = valid && observation.stdout_length == 3U;
  if (result == 1 && stderr_fault == 1U)
    valid = valid && observation.stderr_length == 3U;
  if (result == 1 && stdout_fault == 6U)
    valid = valid && observation.stdout_length == 1U;
  if (result == 1 && stderr_fault == 6U)
    valid = valid && observation.stderr_length == 1U;
  if (result == 1 && stdout_fault == 5U)
    valid = valid && observation.stdout_length == TERMINAL_STREAM_MAXIMUM;
  if (result == 1 && stderr_fault == 5U)
    valid = valid && observation.stderr_length == TERMINAL_STREAM_MAXIMUM;
  if (result == 1 &&
      (tick_fault == 2U || tick_fault == 4U || tick_fault == 5U ||
       tick_fault == 6U || tick_fault == 7U || tick_fault == 9U ||
       tick_fault == 10U))
    valid = valid && observation.kind == TERMINAL_TIMEOUT;
  if (expected_hard_abort) {
    for (DWORD index = 0U; index < TERMINAL_WORKER_COUNT; index += 1U)
      if (active.workers[index].thread != NULL)
        (void)CloseHandle(active.workers[index].thread);
    for (DWORD index = TERMINAL_WORKER_STDOUT;
         index <= TERMINAL_WORKER_STDERR; index += 1U)
      if (active.workers[index].output != NULL)
        (void)HeapFree(GetProcessHeap(), 0U, active.workers[index].output);
  } else {
    release_terminal_observation(&root, &observation);
  }
  return valid;
}

static int fixture_admission_terminal_fault_matrix(void) {
  static BYTE exact[MAX_PAYLOAD];
  static const BYTE challenge[] = {'x', 'y'};
  static ACTIVE_ADMISSION inactive;
  static ROOT_CUSTODY root;
  static TERMINAL_OBSERVATION observation;
  zero_bytes(&inactive, sizeof(inactive));
  zero_bytes(&root, sizeof(root));
  zero_bytes(&observation, sizeof(observation));
  inactive.opened = 1U;
  for (DWORD tick = 9U; tick <= 10U; tick += 1U) {
    fixture_terminal_fault_reset();
    fixture_terminal_tick_fault = tick;
    fixture_terminal_tick_call = 1U;
    if (terminal_wait_before_deadline(ADMISSION_FIXTURE_PROCESS, 100U) != 0)
      return 0;
  }
  if (run_active_terminal(&root, &inactive, challenge, 0U, &observation) != 0 ||
      run_active_terminal(&root, &inactive, challenge, MAX_PAYLOAD + 1U,
                          &observation) != 0)
    return 0;
  for (DWORD failure = 1U; failure <= 2U; failure += 1U)
    if (!fixture_terminal_fault_case(failure, 0U, 0U, 1U, 0U, 0U, 0U,
                                     0U, 0U, 0U, challenge,
                                     sizeof(challenge), 0, 0U,
                                     1U))
      return 0;
  for (DWORD failure = 1U; failure <= TERMINAL_WORKER_COUNT; failure += 1U) {
    if (!fixture_terminal_fault_case(0U, failure, 0U, 1U, 0U, 0U, 0U,
                                     0U, 0U, 0U, challenge,
                                     sizeof(challenge), 0, 0U, 2U) ||
        !fixture_terminal_fault_case(0U, 0U, failure, 1U, 0U, 0U, 0U,
                                     0U, 0U, 0U, challenge,
                                     sizeof(challenge), 0, 0U, 2U))
      return 0;
  }
  for (DWORD resume = 0U; resume <= 2U; resume += 2U)
    if (!fixture_terminal_fault_case(0U, 0U, 0U, resume, 0U, 0U, 0U,
                                     0U, 0U, 0U, challenge,
                                     sizeof(challenge), 0, 0U, 2U))
      return 0;
  if (!fixture_terminal_fault_case(0U, 0U, 0U, 0xffffffffU, 0U, 0U, 0U,
                                   0U, 0U, 0U, challenge,
                                   sizeof(challenge), 0, 0U, 2U))
    return 0;
  if (!fixture_terminal_fault_case(0U, 0U, 0U, 1U, 1U, 1U, 1U,
                                   0U, 0U, 0U, challenge,
                                   sizeof(challenge), 1, 0U, 0U))
    return 0;
  for (DWORD write_fault = 2U; write_fault <= 4U; write_fault += 1U)
    if (!fixture_terminal_fault_case(0U, 0U, 0U, 1U, write_fault, 0U, 0U,
                                     0U, 0U, 0U, challenge,
                                     sizeof(challenge), 0, 0U, 2U))
      return 0;
  for (DWORD stream = 0U; stream < 2U; stream += 1U) {
    DWORD stdout_fault = stream == 0U ? 3U : 0U;
    DWORD stderr_fault = stream == 1U ? 3U : 0U;
    if (!fixture_terminal_fault_case(0U, 0U, 0U, 1U, 0U,
                                     stdout_fault, stderr_fault, 0U, 0U, 0U,
                                     challenge, sizeof(challenge), 0, 0U, 2U))
      return 0;
    stdout_fault = stream == 0U ? 2U : 0U;
    stderr_fault = stream == 1U ? 2U : 0U;
    if (!fixture_terminal_fault_case(0U, 0U, 0U, 1U, 0U,
                                     stdout_fault, stderr_fault, 0U, 0U, 0U,
                                     challenge, sizeof(challenge), 1, 0U, 0U))
      return 0;
    stdout_fault = stream == 0U ? 5U : 0U;
    stderr_fault = stream == 1U ? 5U : 0U;
    if (!fixture_terminal_fault_case(0U, 0U, 0U, 1U, 0U,
                                     stdout_fault, stderr_fault, 0U, 0U, 0U,
                                     challenge, sizeof(challenge), 1, 0U, 0U))
      return 0;
    stdout_fault = stream == 0U ? 6U : 0U;
    stderr_fault = stream == 1U ? 6U : 0U;
    if (!fixture_terminal_fault_case(0U, 0U, 0U, 1U, 0U,
                                     stdout_fault, stderr_fault, 0U, 0U, 0U,
                                     challenge, sizeof(challenge), 1, 0U, 0U))
      return 0;
    stdout_fault = stream == 0U ? 4U : 0U;
    stderr_fault = stream == 1U ? 4U : 0U;
    if (!fixture_terminal_fault_case(0U, 0U, 0U, 1U, 0U,
                                     stdout_fault, stderr_fault, 0U, 0U, 0U,
                                     challenge, sizeof(challenge), 0, 0U, 2U))
      return 0;
  }
  if (!fixture_terminal_fault_case(0U, 0U, 0U, 1U, 5U, 0U, 0U,
                                   0U, 0U, 0U, exact, sizeof(exact),
                                   1, 0U, 0U) ||
      !fixture_terminal_fault_case(0U, 0U, 0U, 1U, 0U, 4U, 4U,
                                   0U, 0U, 0U, challenge,
                                   sizeof(challenge), 0, 0U, 2U))
    return 0;
  if (!fixture_terminal_fault_case(0U, 0U, 0U, 1U, 0U, 0U, 0U,
                                   0U, 0U, 1U, challenge,
                                   sizeof(challenge), -1, 0U, 2U))
    return 0;
  for (DWORD tick = 2U; tick <= 4U; tick += 1U)
    if (!fixture_terminal_fault_case(0U, 0U, 0U, 1U, 0U, 0U, 0U,
                                     0U, 0U, tick, challenge,
                                     sizeof(challenge), 1, 0U,
                                     tick == 3U ? 0U : 2U))
      return 0;
  if (!fixture_terminal_fault_case(0U, 0U, 0U, 1U, 0U, 0U, 0U,
                                   0U, 0U, 5U, challenge,
                                   sizeof(challenge), 1, 0U, 2U))
    return 0;
  for (DWORD tick = 6U; tick <= 7U; tick += 1U)
    if (!fixture_terminal_fault_case(0U, 0U, 0U, 1U, 0U, 0U, 0U,
                                     0U, 0U, tick, challenge,
                                     sizeof(challenge), 1, 0U, 2U))
      return 0;
  if (!fixture_terminal_fault_case(0U, 0U, 0U, 1U, 0U, 0U, 0U,
                                   0U, 0U, 8U, challenge,
                                   sizeof(challenge), -1, 0U, 2U))
    return 0;
  for (DWORD tick = 9U; tick <= 10U; tick += 1U)
    if (!fixture_terminal_fault_case(0U, 0U, 0U, 1U, 0U, 0U, 0U,
                                     0U, 0U, tick, challenge,
                                     sizeof(challenge), 1, 0U, 2U))
      return 0;
  for (DWORD wait = 1U; wait <= TERMINAL_WORKER_COUNT + 1U; wait += 1U)
    if (!fixture_terminal_fault_case(0U, 0U, 0U, 1U, 0U, 0U, 0U,
                                     wait, 0U, 0U, challenge,
                                     sizeof(challenge), -1, 1U, 0U))
      return 0;
  if (!fixture_terminal_fault_case(0U, 0U, 0U, 1U, 0U, 0U, 0U,
                                   0U, 6U, 0U, challenge,
                                   sizeof(challenge), -1, 1U, 0U))
    return 0;
  for (DWORD close_fault = 1U; close_fault <= 12U; close_fault += 1U) {
    int transient = close_fault <= 3U ||
                    (close_fault >= 7U && close_fault <= 9U);
    int transient_pipe = close_fault <= 3U;
    fixture_terminal_requested_close_fault = close_fault;
    if (!fixture_terminal_fault_case(0U, 0U, 0U, 1U, 0U, 0U, 0U,
                                     0U, 0U, 0U, challenge,
                                     sizeof(challenge),
                                     transient ? (transient_pipe ? 0 : 1) : -1,
                                     transient ? 0U : 1U,
                                     transient_pipe ? 2U : 0U))
      return 0;
  }
  for (DWORD buffer_failure = 1U; buffer_failure <= 3U;
       buffer_failure += 1U) {
    fixture_terminal_requested_buffer_free_failure = buffer_failure;
    if (!fixture_terminal_fault_case(0U, 0U, 0U, 1U, 2U, 0U, 0U,
                                     0U, 0U, 0U, challenge,
                                     sizeof(challenge), 0, 1U,
                                     buffer_failure == 3U ? 0U : 1U))
      return 0;
  }
  return 1;
}

static int fixture_terminal_serializer_matrix(void) {
  static BYTE stdout_bytes[] = {'O', 'P', 'W', 'B', 'x'};
  static BYTE stderr_bytes[] = {'e', 'r', 'r'};
  BYTE response[FRAME_BYTES + TERMINAL_METADATA_BYTES +
                sizeof(stdout_bytes) + sizeof(stderr_bytes)];
  TERMINAL_OBSERVATION observation;
  HANDLE response_read = NULL;
  HANDLE response_write = NULL;
  DWORD read = 0U;
  fixture_admission_terminal_mode = 1;
  zero_bytes(&observation, sizeof(observation));
  observation.kind = TERMINAL_EXITED;
  observation.exit_code = 17U;
  observation.stdout_bytes = stdout_bytes;
  observation.stdout_length = sizeof(stdout_bytes);
  observation.stderr_bytes = stderr_bytes;
  observation.stderr_length = sizeof(stderr_bytes);
  for (DWORD fault = 0U; fault <= 1U; fault += 1U) {
    zero_bytes(response, sizeof(response));
    if (!CreatePipe(&response_read, &response_write, NULL, 0U)) return 0;
    fixture_terminal_response_handle = response_write;
    fixture_terminal_response_fault = fault;
    if (!send_terminal_response(response_write, &observation) ||
        !CloseHandle(response_write) ||
        !ReadFile(response_read, response, sizeof(response), &read, NULL) ||
        read != sizeof(response) || !CloseHandle(response_read))
      return 0;
    response_read = NULL;
    response_write = NULL;
    if (response[7] != STATUS_OK ||
        read_u32(response + 8U) != sizeof(response) - FRAME_BYTES ||
        response[12] != 0U || response[13] != 0U || response[14] != 0U ||
        response[15] != 0U || response[FRAME_BYTES] != TERMINAL_EXITED ||
        response[FRAME_BYTES + 1U] != 0U ||
        response[FRAME_BYTES + 2U] != 0U ||
        response[FRAME_BYTES + 3U] != 0U ||
        read_u32(response + FRAME_BYTES + 4U) != 17U ||
        read_u32(response + FRAME_BYTES + 8U) != sizeof(stdout_bytes) ||
        read_u32(response + FRAME_BYTES + 12U) != sizeof(stderr_bytes) ||
        !equal_bytes(response + FRAME_BYTES + TERMINAL_METADATA_BYTES,
                     stdout_bytes, sizeof(stdout_bytes)) ||
        !equal_bytes(response + FRAME_BYTES + TERMINAL_METADATA_BYTES +
                         sizeof(stdout_bytes),
                     stderr_bytes, sizeof(stderr_bytes)))
      return 0;
  }
  for (DWORD fault = 2U; fault <= 3U; fault += 1U) {
    if (!CreatePipe(&response_read, &response_write, NULL, 0U)) return 0;
    fixture_terminal_response_handle = response_write;
    fixture_terminal_response_fault = fault;
    if (send_terminal_response(response_write, &observation)) return 0;
    if (!CloseHandle(response_write) || !CloseHandle(response_read)) return 0;
    response_read = NULL;
    response_write = NULL;
  }
  fixture_terminal_response_handle = NULL;
  fixture_terminal_response_fault = 0U;
  {
    TERMINAL_OBSERVATION invalid = observation;
    invalid.kind = 0U;
    if (send_terminal_response(NULL, &invalid)) return 0;
    invalid = observation;
    invalid.kind = 2U;
    if (send_terminal_response(NULL, &invalid)) return 0;
    invalid = observation;
    invalid.stdout_length = TERMINAL_STREAM_MAXIMUM + 1U;
    if (send_terminal_response(NULL, &invalid)) return 0;
    invalid = observation;
    invalid.stderr_length = TERMINAL_STREAM_MAXIMUM + 1U;
    if (send_terminal_response(NULL, &invalid)) return 0;
    invalid = observation;
    invalid.stdout_bytes = NULL;
    if (send_terminal_response(NULL, &invalid)) return 0;
    invalid = observation;
    invalid.stderr_bytes = NULL;
    if (send_terminal_response(NULL, &invalid)) return 0;
    zero_bytes(&invalid, sizeof(invalid));
    invalid.kind = TERMINAL_TIMEOUT;
    invalid.exit_code = 1U;
    if (send_terminal_response(NULL, &invalid)) return 0;
    zero_bytes(&invalid, sizeof(invalid));
    invalid.kind = TERMINAL_TIMEOUT;
    invalid.stdout_bytes = stdout_bytes;
    invalid.stdout_length = 1U;
    if (send_terminal_response(NULL, &invalid)) return 0;
    zero_bytes(&invalid, sizeof(invalid));
    invalid.kind = TERMINAL_TIMEOUT;
    invalid.stderr_bytes = stderr_bytes;
    invalid.stderr_length = 1U;
    if (send_terminal_response(NULL, &invalid)) return 0;
    zero_bytes(&invalid, sizeof(invalid));
    invalid.kind = TERMINAL_TIMEOUT;
    if (!CreatePipe(&response_read, &response_write, NULL, 0U) ||
        !send_terminal_response(response_write, &invalid) ||
        !CloseHandle(response_write) ||
        !ReadFile(response_read, response, FRAME_BYTES + TERMINAL_METADATA_BYTES,
                  &read, NULL) ||
        read != FRAME_BYTES + TERMINAL_METADATA_BYTES ||
        !CloseHandle(response_read))
      return 0;
  }
  fixture_admission_terminal_mode = 0;
  return 1;
}

static __attribute__((noinline)) int fixture_admission_terminal_matrix(void) {
  static const BYTE challenge[] = {'x'};
  static const BYTE stdout_bytes[] = {'o', 'k'};
  static ROOT_CUSTODY root;
  static ACTIVE_ADMISSION active;
  static ADMISSION_PLAN plan;
  static TERMINAL_OBSERVATION observation;
  HANDLE child_stdin = NULL;
  HANDLE child_stdout = NULL;
  HANDLE child_stderr = NULL;
  HANDLE response_read = NULL;
  HANDLE response_write = NULL;
  static BYTE response[FRAME_BYTES + TERMINAL_METADATA_BYTES +
                       sizeof(stdout_bytes)];
  DWORD written = 0U;
  DWORD read = 0U;
  int result;
  BROKER_FRAME frame_probe;

  zero_bytes(&frame_probe, sizeof(frame_probe));
  frame_probe.operation = LAUNCH_OPERATION;
  frame_probe.payload = (BYTE *)challenge;
  frame_probe.length = 0U;
  if (canonical_frame_payload(&frame_probe)) return 0;
  frame_probe.length = 1U;
  if (!canonical_frame_payload(&frame_probe)) return 0;
  frame_probe.length = MAX_PAYLOAD;
  if (!canonical_frame_payload(&frame_probe)) return 0;
  frame_probe.length = MAX_PAYLOAD + 1U;
  if (canonical_frame_payload(&frame_probe)) return 0;
  frame_probe.operation = TEARDOWN_OPERATION;
  frame_probe.length = 0U;
  if (!canonical_frame_payload(&frame_probe)) return 0;
  frame_probe.length = 1U;
  if (canonical_frame_payload(&frame_probe)) return 0;

  zero_bytes(&root, sizeof(root));
  zero_bytes(&active, sizeof(active));
  zero_bytes(&plan, sizeof(plan));
  zero_bytes(&observation, sizeof(observation));
  plan.job_security = fixture_admission_grant;
  plan.job_security_length = sizeof(fixture_admission_grant);
  active.plan = &plan;
  active.opened = 1U;
  active.runtime.job = ADMISSION_FIXTURE_JOB;
  active.runtime.process.hProcess = ADMISSION_FIXTURE_PROCESS;
  active.runtime.process.hThread = ADMISSION_FIXTURE_THREAD;
  active.runtime.process.dwProcessId = 777U;
  fixture_admission_job_plan = &plan;
  fixture_admission_job_identity = &active.custody;
  fixture_admission_job_present = 1;
  fixture_admission_job_active = 0U;
  fixture_admission_job_fault = 0U;
  fixture_admission_terminal_mode = 1;
  fixture_admission_terminal_timeout = 0;
  fixture_admission_terminal_killed = 0;
  fixture_admission_terminal_exit_code = 0U;
  fixture_admission_resume_result = 1U;
  fixture_admission_resume_count = 0U;
  fixture_admission_tick = 100U;
  if (!CreatePipe(&child_stdin, &active.runtime.stdin_write, NULL, 0U) ||
      !CreatePipe(&active.runtime.stdout_read, &child_stdout, NULL, 0U) ||
      !CreatePipe(&active.runtime.stderr_read, &child_stderr, NULL, 0U) ||
      !WriteFile(child_stdout, stdout_bytes, sizeof(stdout_bytes), &written,
                 NULL) ||
      written != sizeof(stdout_bytes) || !CloseHandle(child_stdout) ||
      !CloseHandle(child_stderr))
    return 0;
  child_stdout = NULL;
  child_stderr = NULL;
  result = run_active_terminal(&root, &active, challenge, sizeof(challenge),
                               &observation);
  if (!CloseHandle(child_stdin)) return 0;
  child_stdin = NULL;
  if (result != 1 || fixture_admission_resume_count != 1U ||
      observation.kind != TERMINAL_EXITED || observation.exit_code != 0U ||
      observation.stdout_length != sizeof(stdout_bytes) ||
      !equal_bytes(observation.stdout_bytes, stdout_bytes,
                   sizeof(stdout_bytes)) ||
      observation.stderr_length != 0U || !active.terminal)
    return 0;
  if (!CreatePipe(&response_read, &response_write, NULL, 0U) ||
      !send_terminal_response(response_write, &observation) ||
      !CloseHandle(response_write) ||
      !ReadFile(response_read, response, sizeof(response), &read, NULL) ||
      read != sizeof(response) || !CloseHandle(response_read))
    return 0;
  response_read = NULL;
  response_write = NULL;
  if (response[0] != 'O' || response[1] != 'P' || response[2] != 'W' ||
      response[3] != 'B' || response[4] != PROTOCOL_VERSION ||
      response[5] != RESPONSE_KIND || response[6] != LAUNCH_OPERATION ||
      response[7] != STATUS_OK ||
      read_u32(response + 8U) != TERMINAL_METADATA_BYTES +
                                      sizeof(stdout_bytes) ||
      response[FRAME_BYTES] != TERMINAL_EXITED ||
      read_u32(response + FRAME_BYTES + 4U) != 0U ||
      read_u32(response + FRAME_BYTES + 8U) != sizeof(stdout_bytes) ||
      read_u32(response + FRAME_BYTES + 12U) != 0U ||
      !equal_bytes(response + FRAME_BYTES + TERMINAL_METADATA_BYTES,
                   stdout_bytes, sizeof(stdout_bytes)))
    return 0;
  {
    TERMINAL_OBSERVATION invalid = observation;
    invalid.kind = 2U;
    if (send_terminal_response(NULL, &invalid)) return 0;
    invalid = observation;
    invalid.kind = TERMINAL_TIMEOUT;
    invalid.exit_code = 0U;
    if (send_terminal_response(NULL, &invalid)) return 0;
  }
  release_terminal_observation(&root, &observation);
  if (root.resource_ambiguous) return 0;

  zero_bytes(&active, sizeof(active));
  active.plan = &plan;
  active.opened = 1U;
  active.runtime.job = ADMISSION_FIXTURE_JOB;
  active.runtime.process.hProcess = ADMISSION_FIXTURE_PROCESS;
  active.runtime.process.hThread = ADMISSION_FIXTURE_THREAD;
  active.runtime.process.dwProcessId = 777U;
  fixture_admission_job_present = 1;
  fixture_admission_job_active = 1U;
  fixture_admission_terminal_timeout = 1;
  fixture_admission_terminal_killed = 0;
  fixture_admission_resume_result = 1U;
  fixture_admission_resume_count = 0U;
  fixture_admission_tick = 200U;
  if (!CreatePipe(&child_stdin, &active.runtime.stdin_write, NULL, 0U) ||
      !CreatePipe(&active.runtime.stdout_read, &child_stdout, NULL, 0U) ||
      !CreatePipe(&active.runtime.stderr_read, &child_stderr, NULL, 0U) ||
      !CloseHandle(child_stdout) || !CloseHandle(child_stderr))
    return 0;
  result = run_active_terminal(&root, &active, challenge, sizeof(challenge),
                               &observation);
  if (!CloseHandle(child_stdin)) return 0;
  child_stdin = NULL;
  if (result != 1 || observation.kind != TERMINAL_TIMEOUT ||
      observation.exit_code != 0U || observation.stdout_length != 0U ||
      observation.stderr_length != 0U || !fixture_admission_terminal_killed ||
      fixture_admission_resume_count != 1U)
    return 0;

  zero_bytes(&active, sizeof(active));
  active.plan = &plan;
  active.opened = 1U;
  active.runtime.job = ADMISSION_FIXTURE_JOB;
  active.runtime.process.hProcess = ADMISSION_FIXTURE_PROCESS;
  active.runtime.process.hThread = ADMISSION_FIXTURE_THREAD;
  active.runtime.process.dwProcessId = 777U;
  fixture_admission_job_present = 1;
  fixture_admission_job_active = 1U;
  fixture_admission_terminal_timeout = 0;
  fixture_admission_terminal_killed = 0;
  fixture_admission_resume_result = 0U;
  fixture_admission_resume_count = 0U;
  fixture_admission_tick = 300U;
  if (!CreatePipe(&child_stdin, &active.runtime.stdin_write, NULL, 0U) ||
      !CreatePipe(&active.runtime.stdout_read, &child_stdout, NULL, 0U) ||
      !CreatePipe(&active.runtime.stderr_read, &child_stderr, NULL, 0U) ||
      !CloseHandle(child_stdout) || !CloseHandle(child_stderr))
    return 0;
  result = run_active_terminal(&root, &active, challenge, sizeof(challenge),
                               &observation);
  if (!CloseHandle(child_stdin)) return 0;
  if (result != 0 || fixture_admission_resume_count != 1U ||
      !fixture_admission_terminal_killed || root.resource_ambiguous)
    return 0;
  fixture_admission_terminal_mode = 0;
  return 1;
}

static int fixture_admission_live_revoke_matrix(
    PROFILE_IDENTITY *identity) {
  ROOT_CUSTODY *root = &fixture_admission_test_root;
  EXECUTION_CUSTODY *execution = &fixture_admission_test_execution;
  ACTIVE_ADMISSION active;
  int outcome;
  zero_bytes(root, sizeof(*root));
  fixture_admission_objects(execution);
  for (DWORD index = 0U; index < 4U; index += 1U)
    fixture_admission_profiles[index] = 1U;
  zero_bytes(&active, sizeof(active));
  active.plan = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY,
                          sizeof(*active.plan));
  if (active.plan == NULL) return 0;
  active.plan->grant_security = fixture_admission_grant;
  active.plan->grant_security_length = sizeof(fixture_admission_grant);
  active.plan->job_security = fixture_admission_grant;
  active.plan->job_security_length = sizeof(fixture_admission_grant);
  active.custody.phase = ADMISSION_PROVED;
  active.custody.job_name[0] = L'J';
  active.custody.job_name[1] = L'\0';
  active.runtime.job = ADMISSION_FIXTURE_JOB;
  active.runtime.process.hProcess = ADMISSION_FIXTURE_PROCESS;
  active.runtime.process_token = ADMISSION_FIXTURE_PROCESS_TOKEN;
  active.runtime.impersonation_token = ADMISSION_FIXTURE_IMPERSONATION_TOKEN;
  active.opened = 1U;
  fixture_admission_orchestration_reset();
  fixture_admission_terminal_mode = 1;
  fixture_admission_access_count = 0U;
  fixture_admission_open_count = 0U;
  fixture_admission_access_fail = 0U;
  fixture_admission_open_fail = 0U;
  fixture_admission_token_fault = 0U;
  fixture_admission_job_fault = 0U;
  fixture_admission_job_present = 1;
  fixture_admission_job_active = 0U;
  fixture_admission_job_plan = active.plan;
  fixture_admission_job_identity = &active.custody;
  fixture_admission_execution = execution;
  fixture_admission_identity = identity;
  fixture_admission_root = root;
  fixture_terminal_order_mode = 1;
  fixture_terminal_order_count = 0U;
  zero_bytes(fixture_terminal_order, sizeof(fixture_terminal_order));
  outcome = revoke_active_admission(root, identity, execution, &active, 1, 1);
  fixture_terminal_order_mode = 0;
  fixture_admission_terminal_mode = 0;
  if (fixture_terminal_order_count != 65U ||
      fixture_terminal_order[0] != 82U ||
      fixture_terminal_order[1] != 81U ||
      fixture_terminal_order[2] != 66U ||
      fixture_terminal_order[3] != 96U ||
      fixture_terminal_order[60] != 95U ||
      fixture_terminal_order[61] != 83U ||
      fixture_terminal_order[62] != 81U ||
      fixture_terminal_order[63] != 67U ||
      fixture_terminal_order[64] != 84U)
    return 0;
  for (DWORD index = 4U; index < 32U; index += 1U)
    if (fixture_terminal_order[index] != 93U) return 0;
  for (DWORD index = 32U; index < 60U; index += 1U)
    if (fixture_terminal_order[index] != 94U) return 0;
  return outcome == 1 && active.plan == NULL && active.opened == 0U &&
         fixture_admission_persisted_count == 2U &&
         fixture_admission_persisted[0] == ADMISSION_REVOKE_ATTEMPTED &&
         fixture_admission_persisted[1] == ADMISSION_ABSENCE_PROVED &&
         fixture_admission_access_count == 28U &&
         fixture_admission_open_count == 28U &&
         fixture_admission_cleanup_count == 1U &&
         fixture_admission_restore_count == 1U &&
         !fixture_admission_job_present && !root->resource_ambiguous;
}

__declspec(noreturn) void fixture_entry(void) {
  SID_IDENTIFIER_AUTHORITY nt = SECURITY_NT_AUTHORITY;
  SID_IDENTIFIER_AUTHORITY package = {{0U, 0U, 0U, 0U, 0U, 15U}};
  BYTE stable[16];
  BYTE app[16];
  DWORD stable_length;
  DWORD app_length;
  PROFILE_IDENTITY identity;
  int valid = 0;
  zero_bytes(&identity, sizeof(identity));
  stable_length = fixture_admission_sid_bytes(stable, nt, 2U, 21U, 4242U);
  app_length = fixture_admission_sid_bytes(app, package, 2U, 2U, 4242U);
  identity.sid_length = (WORD)app_length;
  copy_bytes(identity.sid, app, app_length);
  identity.sid_text_length =
      (WORD)ascii_length("S-1-15-2-4242");
  copy_bytes(identity.sid_text, "S-1-15-2-4242",
             identity.sid_text_length + 1U);
  valid = fixture_admission_recovery_matrix();
  if (!valid) ExitProcess(11U);
  valid = fixture_admission_grant_order();
  if (!valid) ExitProcess(12U);
  valid = fixture_admission_launch_matrix(&identity);
  if (!valid) ExitProcess(fixture_admission_matrix_stage);
  valid = fixture_admission_canonical_plan_matrix(&identity, stable,
                                                  stable_length);
  if (!valid) ExitProcess(fixture_admission_matrix_stage);
  valid = fixture_admission_token_matrix(&identity, stable, stable_length);
  if (!valid) ExitProcess(14U);
  valid = fixture_admission_job_matrix();
  if (!valid) ExitProcess(15U);
  valid = fixture_admission_lifecycle_matrix(&identity);
  if (!valid) ExitProcess(fixture_admission_matrix_stage);
  valid = fixture_admission_outer_recovery_matrix(&identity);
  if (!valid) ExitProcess(17U);
  valid = fixture_admission_terminal_matrix();
  if (!valid) ExitProcess(18U);
  valid = fixture_admission_terminal_fault_matrix();
  if (!valid) ExitProcess(20U);
  valid = fixture_terminal_serializer_matrix();
  if (!valid) ExitProcess(21U);
  valid = fixture_admission_live_revoke_matrix(&identity);
  ExitProcess(valid ? 0U : 19U);
}

#elif defined(OP_WINDOWS_ADMISSION_FIXTURE)

static DWORD fixture_admission_stage;
static BYTE fixture_admission_overbound_job[
    8U + sizeof(SIZE_T) * (JOB_PROCESS_MAXIMUM + 1U)];

static void fixture_admission_sid(BYTE sid[12], DWORD authority) {
  zero_bytes(sid, 12U);
  sid[0] = 1U;
  sid[1] = 1U;
  sid[7] = 5U;
  write_u32(sid + 8U, authority);
}

static int fixture_expected_transition(BYTE current, BYTE kind) {
  if (kind == ADMISSION_GRANT_ATTEMPTED) return current == 0U;
  if (kind >= ADMISSION_GRANTED && kind <= ADMISSION_PROVED)
    return current == (BYTE)(kind - 1U);
  if (kind == ADMISSION_REVOKE_ATTEMPTED)
    return current >= ADMISSION_GRANT_ATTEMPTED &&
           current <= ADMISSION_PROVED;
  return kind == ADMISSION_ABSENCE_PROVED &&
         current == ADMISSION_REVOKE_ATTEMPTED;
}

static int fixture_expected_set(const BYTE seen[8]) {
  BYTE last = 0U;
  if (!seen[ADMISSION_GRANT_ATTEMPTED]) {
    for (BYTE kind = ADMISSION_GRANTED;
         kind <= ADMISSION_ABSENCE_PROVED; kind += 1U)
      if (seen[kind]) return 0;
    return 1;
  }
  for (BYTE kind = ADMISSION_GRANT_ATTEMPTED;
       kind <= ADMISSION_PROVED; kind += 1U) {
    if (!seen[kind]) {
      for (BYTE later = (BYTE)(kind + 1U);
           later <= ADMISSION_PROVED; later += 1U)
        if (seen[later]) return 0;
      break;
    }
    last = kind;
  }
  return last != 0U &&
         (!seen[ADMISSION_ABSENCE_PROVED] ||
          seen[ADMISSION_REVOKE_ATTEMPTED]);
}

static int fixture_admission_contracts(void) {
  ROOT_CUSTODY root;
  PROFILE_IDENTITY identity;
  ADMISSION_CUSTODY admission;
  BYTE record[4096];
  BYTE stable_sid[12];
  BYTE system_sid[12];
  BYTE admin_sid[12];
  BYTE user_buffer[sizeof(TOKEN_USER) + 12U];
  BYTE zero_groups[8];
  BYTE one_group[8U + sizeof(SID_AND_ATTRIBUTES) + 12U];
  BYTE two_groups[8U + sizeof(SID_AND_ATTRIBUTES) * 2U + 24U];
  BYTE job_list[8U + sizeof(SIZE_T) * 2U];
  DWORD observed = 0U;
  DWORD sid_length = 0U;
  zero_bytes(&root, sizeof(root));
  zero_bytes(&identity, sizeof(identity));
  zero_bytes(&admission, sizeof(admission));
  fixture_admission_sid(stable_sid, 1000U);
  fixture_admission_sid(system_sid, SECURITY_LOCAL_SYSTEM_RID);
  fixture_admission_sid(admin_sid, DOMAIN_ALIAS_RID_ADMINS);
  root.stable_sid = stable_sid;
  root.stable_sid_length = 12U;
  root.digest[0] = 1U;
  fixture_admission_stage = 1U;
  identity.token[0] = 2U;
  identity.sid_length = 12U;
  identity.phase = JOURNAL_PROFILE_CREATED;
  copy_bytes(identity.sid, stable_sid, 12U);
  admission.profile_created_digest[0] = 3U;
  admission.execution_created_digest[0] = 4U;
  admission.grant_digest[0] = 5U;
  admission.launch_digest[0] = 6U;
  if (!admission_job_name(identity.token, admission.job_name,
                          &admission.job_name_units))
    return 0;
  for (BYTE current = 0U; current <= ADMISSION_ABSENCE_PROVED;
       current += 1U) {
    for (BYTE kind = ADMISSION_GRANT_ATTEMPTED;
         kind <= ADMISSION_ABSENCE_PROVED; kind += 1U) {
      int expected = fixture_expected_transition(current, kind);
      admission.phase = current;
      if (valid_admission_transition(current, kind) != expected ||
          !!admission_record(&root, &identity, &admission, kind, record,
                             sizeof(record)) != !!expected)
        return 0;
    }
  }
  for (DWORD mask = 0U; mask < 128U; mask += 1U) {
    fixture_admission_stage = 2U;
    BYTE seen[8];
    BYTE last = 0U;
    zero_bytes(seen, sizeof(seen));
    for (BYTE kind = ADMISSION_GRANT_ATTEMPTED;
         kind <= ADMISSION_ABSENCE_PROVED; kind += 1U)
      seen[kind] = (BYTE)((mask >> (kind - 1U)) & 1U);
    if (valid_admission_final_set(seen, &last) !=
        fixture_expected_set(seen))
      return 0;
  }

  fixture_admission_stage = 3U;
  zero_bytes(user_buffer, sizeof(user_buffer));
  ((TOKEN_USER *)user_buffer)->User.Sid = user_buffer + sizeof(TOKEN_USER);
  copy_bytes(user_buffer + sizeof(TOKEN_USER), stable_sid, 12U);
  if (!exact_detached_sid_value(user_buffer, sizeof(user_buffer),
                                sizeof(TOKEN_USER),
                                ((TOKEN_USER *)user_buffer)->User.Sid,
                                stable_sid) ||
      detached_sid(user_buffer, sizeof(user_buffer), sizeof(TOKEN_USER),
                   user_buffer + sizeof(TOKEN_USER) + 1U, &sid_length) ||
      exact_detached_sid_value(user_buffer, sizeof(user_buffer) - 1U,
                               sizeof(TOKEN_USER),
                               ((TOKEN_USER *)user_buffer)->User.Sid,
                               stable_sid))
    return 0;

  fixture_admission_stage = 4U;
  zero_bytes(zero_groups, sizeof(zero_groups));
  if (!closed_token_groups(zero_groups, sizeof(zero_groups), 1, &root,
                           system_sid, admin_sid) ||
      closed_token_groups(zero_groups, sizeof(zero_groups) - 1U, 1, &root,
                          system_sid, admin_sid))
    return 0;

  fixture_admission_stage = 5U;
  zero_bytes(one_group, sizeof(one_group));
  ((TOKEN_GROUPS *)one_group)->GroupCount = 1U;
  ((TOKEN_GROUPS *)one_group)->Groups[0].Attributes = SE_GROUP_ENABLED;
  ((TOKEN_GROUPS *)one_group)->Groups[0].Sid =
      one_group + 8U + sizeof(SID_AND_ATTRIBUTES);
  fixture_admission_sid(
      one_group + 8U + sizeof(SID_AND_ATTRIBUTES), 2000U);
  if (!closed_token_groups(one_group, sizeof(one_group), 0, &root,
                           system_sid, admin_sid) ||
      closed_token_groups(one_group, sizeof(one_group) - 1U, 0, &root,
                          system_sid, admin_sid))
    return 0;

  fixture_admission_stage = 6U;
  zero_bytes(two_groups, sizeof(two_groups));
  ((TOKEN_GROUPS *)two_groups)->GroupCount = 2U;
  for (DWORD index = 0U; index < 2U; index += 1U) {
    ((TOKEN_GROUPS *)two_groups)->Groups[index].Attributes = SE_GROUP_ENABLED;
    ((TOKEN_GROUPS *)two_groups)->Groups[index].Sid =
        two_groups + 8U + sizeof(SID_AND_ATTRIBUTES) * 2U + index * 12U;
    fixture_admission_sid(
        two_groups + 8U + sizeof(SID_AND_ATTRIBUTES) * 2U + index * 12U,
        3000U);
  }
  if (closed_token_groups(two_groups, sizeof(two_groups), 0, &root,
                          system_sid, admin_sid))
    return 0;

  fixture_admission_stage = 7U;
  zero_bytes(job_list, sizeof(job_list));
  if (!closed_job_process_list(job_list, 8U, 0U, 0U, &observed) ||
      closed_job_process_list(job_list, 7U, 0U, 0U, &observed))
    return 0;
  ((JOBOBJECT_BASIC_PROCESS_ID_LIST *)job_list)->NumberOfAssignedProcesses = 1U;
  ((JOBOBJECT_BASIC_PROCESS_ID_LIST *)job_list)->NumberOfProcessIdsInList = 1U;
  ((JOBOBJECT_BASIC_PROCESS_ID_LIST *)job_list)->ProcessIdList[0] = 42U;
  fixture_admission_stage = 8U;
  if (!closed_job_process_list(job_list, 16U, 1U, 42U, &observed) ||
      closed_job_process_list(job_list, 16U, 1U, 43U, &observed))
    return 0;
  ((JOBOBJECT_BASIC_PROCESS_ID_LIST *)job_list)->NumberOfAssignedProcesses = 2U;
  ((JOBOBJECT_BASIC_PROCESS_ID_LIST *)job_list)->NumberOfProcessIdsInList = 2U;
  ((JOBOBJECT_BASIC_PROCESS_ID_LIST *)job_list)->ProcessIdList[1] = 42U;
  fixture_admission_stage = 9U;
  if (closed_job_process_list(job_list, sizeof(job_list), 2U, 0U,
                              &observed))
    return 0;

  fixture_admission_stage = 10U;
  zero_bytes(fixture_admission_overbound_job,
             sizeof(fixture_admission_overbound_job));
  ((JOBOBJECT_BASIC_PROCESS_ID_LIST *)fixture_admission_overbound_job)
      ->NumberOfAssignedProcesses = JOB_PROCESS_MAXIMUM + 1U;
  ((JOBOBJECT_BASIC_PROCESS_ID_LIST *)fixture_admission_overbound_job)
      ->NumberOfProcessIdsInList = JOB_PROCESS_MAXIMUM + 1U;
  for (DWORD index = 0U; index <= JOB_PROCESS_MAXIMUM; index += 1U)
    ((JOBOBJECT_BASIC_PROCESS_ID_LIST *)fixture_admission_overbound_job)
        ->ProcessIdList[index] = 1000U + index;
  if (closed_job_process_list(fixture_admission_overbound_job,
                              sizeof(fixture_admission_overbound_job),
                              0xffffffffU, 0U, &observed))
    return 0;

  fixture_admission_stage = 11U;
  if (sizeof(denied_execution_rights) / sizeof(DWORD) != 6U ||
      denied_execution_rights[0] != GENERIC_WRITE ||
      denied_execution_rights[1] != FILE_APPEND_DATA ||
      denied_execution_rights[2] != DELETE ||
      denied_execution_rights[3] != WRITE_DAC ||
      denied_execution_rights[4] != WRITE_OWNER ||
      denied_execution_rights[5] != ACCESS_SYSTEM_SECURITY)
    return 0;
  return 1;
}

__declspec(noreturn) void fixture_entry(void) {
  ExitProcess(fixture_admission_contracts() ? 0U : fixture_admission_stage);
}

#elif defined(OP_WINDOWS_ABSENCE_VERIFIER)

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

#elif defined(OP_WINDOWS_EXECUTION_FIXTURE)

__declspec(dllimport) BOOL WINAPI SetFileAttributesW(PCWSTR, DWORD);

static BYTE fixture_execution_case;
static int fixture_execution_root_created;
static int fixture_execution_short_write_fired;
static BYTE fixture_execution_fault_phase;
static BYTE fixture_execution_active_publication_phase;
static BYTE fixture_execution_fault_point;
static int fixture_execution_fault_active;
static HANDLE fixture_execution_pending_handle;
static WCHAR fixture_execution_pending_path[1200];
static HANDLE fixture_execution_record_handle;
static HANDLE fixture_execution_state_handle;
static DWORD fixture_execution_product_deletes;
static int fixture_execution_count_deletes;
static DWORD fixture_execution_find_close_calls;
static DWORD fixture_execution_find_close_target;
static BYTE fixture_execution_stage;
static int fixture_execution_target_write_complete;
static int fixture_execution_cleanup_find_close;
static int fixture_execution_simultaneous_close;
static WCHAR fixture_execution_root_path[PATH_MAX_UNITS + 1U];
static BYTE fixture_execution_delete_order[4];
static DWORD fixture_execution_delete_order_count;
static int fixture_execution_unidentified_delete;
static int fixture_execution_track_recovery_opens;
static DWORD fixture_execution_target_opens[EXECUTION_ROLE_COUNT];

static int fixture_execution_ending(PCWSTR path, PCWSTR ending) {
  SIZE_T path_units = wide_length(path);
  SIZE_T ending_units = wide_length(ending);
  if (path_units < ending_units) return 0;
  for (SIZE_T index = 0U; index < ending_units; index += 1U)
    if (path[path_units - ending_units + index] != ending[index]) return 0;
  return 1;
}

static BYTE fixture_execution_object_role(PCWSTR path) {
  static const WCHAR *target_names[] = {
    L"node.exe", L"rpc-runner.mjs", L"candidate.mjs"
  };
  if (fixture_execution_root_path[0] != L'\0' &&
      wide_equal(path, fixture_execution_root_path))
    return 4U;
  for (BYTE role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U) {
    WCHAR target[PATH_MAX_UNITS + 1U];
    DWORD cursor = 0U;
    if (!append_wide(target, PATH_MAX_UNITS + 1U, &cursor,
                     fixture_execution_root_path) ||
        !append_wide(target, PATH_MAX_UNITS + 1U, &cursor, L"\\") ||
        !append_wide(target, PATH_MAX_UNITS + 1U, &cursor,
                     target_names[role]))
      return 0U;
    if (wide_equal(path, target))
      return (BYTE)(role + 1U);
  }
  return 0U;
}

static void fixture_execution_reset_delete_order(void) {
  fixture_execution_delete_order_count = 0U;
  fixture_execution_unidentified_delete = 0;
  zero_bytes(fixture_execution_delete_order,
             sizeof(fixture_execution_delete_order));
}

static int fixture_execution_exact_delete_order(const BYTE *roles,
                                                DWORD count) {
  return !fixture_execution_unidentified_delete &&
         fixture_execution_delete_order_count == count &&
         equal_bytes(fixture_execution_delete_order, roles, count);
}

static BYTE fixture_execution_path_phase(PCWSTR path, int *pending) {
  static const WCHAR *endings[] = {
    L"", L"-00-attempted.opwx", L"-01-created.opwx",
    L"-02-delete-attempted.opwx", L"-03-absence-proved.opwx"
  };
  *pending = 0;
  for (BYTE kind = EXECUTION_ATTEMPTED;
       kind <= EXECUTION_ABSENCE_PROVED; kind += 1U) {
    WCHAR pending_ending[64];
    DWORD cursor = 0U;
    if (fixture_execution_ending(path, endings[kind])) return kind;
    if (!append_wide(pending_ending, 64U, &cursor, endings[kind]) ||
        !append_wide(pending_ending, 64U, &cursor, L".pending"))
      return 0U;
    if (fixture_execution_ending(path, pending_ending)) {
      *pending = 1;
      return kind;
    }
  }
  return 0U;
}

static HANDLE WINAPI fixture_execution_CreateFileW(
    PCWSTR path, DWORD access, DWORD sharing,
    SECURITY_ATTRIBUTES *attributes, DWORD creation, DWORD flags,
    HANDLE template_file) {
  int pending = 0;
  BYTE phase = fixture_execution_path_phase(path, &pending);
  HANDLE result;
  if (fixture_execution_fault_active &&
      phase == fixture_execution_fault_phase && pending &&
      creation == CREATE_NEW && fixture_execution_fault_point == 1U) {
    SetLastError(5U);
    return INVALID_HANDLE_VALUE;
  }
  if (fixture_execution_fault_active &&
      phase == fixture_execution_fault_phase && !pending &&
      creation == OPEN_EXISTING && fixture_execution_fault_point == 12U) {
    SetLastError(5U);
    return INVALID_HANDLE_VALUE;
  }
  result = CreateFileW(path, access, sharing, attributes, creation, flags,
                       template_file);
  if (result != INVALID_HANDLE_VALUE) {
    BYTE role = fixture_execution_object_role(path);
    if (role != 0U) {
      if (fixture_execution_track_recovery_opens && role <= 3U &&
          creation == OPEN_EXISTING)
        fixture_execution_target_opens[role - 1U] += 1U;
    }
  }
  if (result != INVALID_HANDLE_VALUE && pending && phase != 0U)
    fixture_execution_active_publication_phase = phase;
  if (result != INVALID_HANDLE_VALUE && pending && phase != 0U) {
    fixture_execution_pending_handle = result;
    copy_bytes(fixture_execution_pending_path, path,
               ((DWORD)wide_length(path) + 1U) * 2U);
  }
  if (result != INVALID_HANDLE_VALUE &&
      phase == fixture_execution_fault_phase) {
    if (!pending) fixture_execution_record_handle = result;
  }
  return result;
}

static BOOL WINAPI fixture_execution_CreateDirectoryW(
    PCWSTR path, SECURITY_ATTRIBUTES *attributes) {
  BOOL created = CreateDirectoryW(path, attributes);
  if (!created) return FALSE;
  fixture_execution_root_created = 1;
  copy_bytes(fixture_execution_root_path, path,
             ((DWORD)wide_length(path) + 1U) * 2U);
  if (fixture_execution_case == 6U) {
    WCHAR stream[PATH_MAX_UNITS + 32U];
    DWORD cursor = 0U;
    HANDLE file;
    DWORD written = 0U;
    BYTE value = 1U;
    if (!append_wide(stream, PATH_MAX_UNITS + 32U, &cursor, path) ||
        !append_wide(stream, PATH_MAX_UNITS + 32U, &cursor,
                     L":fixture:$DATA"))
      return FALSE;
    file = CreateFileW(stream, GENERIC_WRITE, FILE_SHARE_READ, NULL,
                       CREATE_NEW, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE ||
        !WriteFile(file, &value, 1U, &written, NULL) || written != 1U ||
        !CloseHandle(file))
      return FALSE;
  }
  if (fixture_execution_case == 2U ||
      (fixture_execution_case >= 10U && fixture_execution_case <= 33U) ||
      fixture_execution_case == 38U) {
    SetLastError(5U);
    return FALSE;
  }
  return TRUE;
}

static BOOL WINAPI fixture_execution_WriteFile(HANDLE file, LPCVOID bytes,
                                                DWORD length, DWORD *written,
                                                LPVOID overlapped) {
  if (fixture_execution_fault_active &&
      fixture_execution_active_publication_phase ==
          fixture_execution_fault_phase &&
      file == fixture_execution_pending_handle) {
    if (fixture_execution_fault_point == 2U) return FALSE;
    if (fixture_execution_fault_point == 3U) {
      if (!WriteFile(file, bytes, length, written, overlapped)) return FALSE;
      if (*written != 0U) *written -= 1U;
      return TRUE;
    }
  }
  if (fixture_execution_case == 3U && fixture_execution_root_created &&
      !fixture_execution_short_write_fired && length > 1U) {
    DWORD partial = length / 2U;
    fixture_execution_short_write_fired = 1;
    return WriteFile(file, bytes, partial, written, overlapped);
  }
  {
    BOOL result = WriteFile(file, bytes, length, written, overlapped);
    if (result && fixture_execution_case == 37U &&
        fixture_execution_root_created)
      fixture_execution_target_write_complete = 1;
    return result;
  }
}

static BOOL WINAPI fixture_execution_ReadFile(HANDLE file, LPVOID bytes,
                                               DWORD length, DWORD *read,
                                               LPVOID overlapped) {
  if (fixture_execution_fault_active &&
      fixture_execution_active_publication_phase ==
          fixture_execution_fault_phase &&
      file == fixture_execution_pending_handle &&
      fixture_execution_fault_point == 5U)
    return FALSE;
  return ReadFile(file, bytes, length, read, overlapped);
}

static BOOL WINAPI fixture_execution_FlushFileBuffers(HANDLE file) {
  if (fixture_execution_fault_active &&
      ((file == fixture_execution_pending_handle &&
        fixture_execution_active_publication_phase ==
            fixture_execution_fault_phase &&
        fixture_execution_fault_point == 4U) ||
       (file == fixture_execution_state_handle &&
        fixture_execution_active_publication_phase ==
            fixture_execution_fault_phase &&
        fixture_execution_fault_point == 10U)))
    return FALSE;
  return FlushFileBuffers(file);
}

static BOOL WINAPI fixture_execution_GetFileInformationByHandle(
    HANDLE file, BY_HANDLE_FILE_INFORMATION *information) {
  if (fixture_execution_fault_active &&
      fixture_execution_active_publication_phase ==
          fixture_execution_fault_phase &&
      file == fixture_execution_pending_handle &&
      fixture_execution_fault_point == 6U)
    return FALSE;
  return GetFileInformationByHandle(file, information);
}

static BOOL WINAPI fixture_execution_GetFileInformationByHandleEx(
    HANDLE file, FILE_INFO_BY_HANDLE_CLASS kind, LPVOID information,
    DWORD length) {
  if (fixture_execution_fault_active &&
      fixture_execution_active_publication_phase ==
          fixture_execution_fault_phase &&
      file == fixture_execution_pending_handle && kind == FileIdInfo &&
      fixture_execution_fault_point == 7U)
    return FALSE;
  return GetFileInformationByHandleEx(file, kind, information, length);
}

static BOOL WINAPI fixture_execution_SetFileInformationByHandle(
    HANDLE file, FILE_INFO_BY_HANDLE_CLASS kind, LPVOID information,
    DWORD length) {
  if (fixture_execution_count_deletes && kind == FileDispositionInfo) {
    WCHAR final_path[PATH_MAX_UNITS + 1U];
    DWORD final_units = GetFinalPathNameByHandleW(
        file, final_path, PATH_MAX_UNITS + 1U,
        FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    int pending = 0;
    BYTE role = 0U;
    BYTE phase = 0U;
    if (final_units == 0U || final_units > PATH_MAX_UNITS) {
      fixture_execution_unidentified_delete = 1;
    } else {
      phase = fixture_execution_path_phase(final_path, &pending);
      if (!pending || phase == 0U)
        role = fixture_execution_object_role(final_path);
    }
    if (pending && phase != 0U &&
        file == fixture_execution_pending_handle &&
        phase == fixture_execution_active_publication_phase &&
        wide_equal(final_path, fixture_execution_pending_path)) {
      /* Journal rollback is not execution-object destruction. */
    } else if (role != 0U) {
      fixture_execution_product_deletes += 1U;
      if (fixture_execution_delete_order_count >= 4U) {
        fixture_execution_unidentified_delete = 1;
      } else {
        fixture_execution_delete_order[fixture_execution_delete_order_count] =
            role;
        fixture_execution_delete_order_count += 1U;
      }
    } else {
      fixture_execution_unidentified_delete = 1;
    }
  }
  if (fixture_execution_fault_active &&
      fixture_execution_active_publication_phase ==
          fixture_execution_fault_phase &&
      file == fixture_execution_pending_handle && kind == FileRenameInfoEx &&
      fixture_execution_fault_point == 8U)
    return FALSE;
  return SetFileInformationByHandle(file, kind, information, length);
}

static DWORD WINAPI fixture_execution_GetFileAttributesW(PCWSTR path) {
  int pending = 0;
  BYTE phase = fixture_execution_path_phase(path, &pending);
  if (fixture_execution_fault_active &&
      phase == fixture_execution_fault_phase && pending &&
      fixture_execution_fault_point == 9U)
    return FILE_ATTRIBUTE_NORMAL;
  return GetFileAttributesW(path);
}

static BOOL WINAPI fixture_execution_CloseHandle(HANDLE file) {
  int pending = file == fixture_execution_pending_handle;
  int record = file == fixture_execution_record_handle;
  BYTE publication_phase = fixture_execution_active_publication_phase;
  BOOL result = CloseHandle(file);
  if (pending) {
    fixture_execution_pending_handle = INVALID_HANDLE_VALUE;
    fixture_execution_pending_path[0] = L'\0';
    fixture_execution_active_publication_phase = 0U;
  }
  if (fixture_execution_simultaneous_close) {
    fixture_execution_simultaneous_close = 0;
    return FALSE;
  }
  if (fixture_execution_fault_active &&
      publication_phase == fixture_execution_fault_phase &&
      (pending || record) &&
      fixture_execution_fault_point == 11U)
    return FALSE;
  return result;
}

static BOOL WINAPI fixture_execution_FindClose(HANDLE find) {
  BOOL result = FindClose(find);
  int fail = 0;
  fixture_execution_find_close_calls += 1U;
  if (fixture_execution_find_close_target != 0U &&
      fixture_execution_find_close_calls ==
          fixture_execution_find_close_target)
    fail = 1;
  if (fixture_execution_case == 36U && fixture_execution_root_created)
    fail = 1;
  if (fixture_execution_case == 37U &&
      fixture_execution_target_write_complete)
    fail = 1;
  if (fixture_execution_cleanup_find_close) {
    fixture_execution_cleanup_find_close = 0;
    fail = 1;
  }
  if (fail) {
    if (fixture_execution_case == 40U)
      fixture_execution_simultaneous_close = 1;
    return FALSE;
  }
  return result;
}

DWORD WINAPI fixture_enum_appcontainers(DWORD flags, DWORD *count,
                                        PINET_FIREWALL_APP_CONTAINER *rows) {
  if (flags != NETISO_FLAG_FORCE_COMPUTE_BINARIES || count == NULL ||
      rows == NULL)
    return 87U;
  *count = 0U;
  *rows = NULL;
  return ERROR_SUCCESS;
}

DWORD WINAPI fixture_free_appcontainers(PINET_FIREWALL_APP_CONTAINER rows) {
  return rows == NULL ? ERROR_SUCCESS : 87U;
}

static int fixture_execution_stream(const WCHAR *path) {
  WCHAR stream[PATH_MAX_UNITS + 32U];
  DWORD cursor = 0U;
  HANDLE file;
  DWORD written = 0U;
  BYTE value = 1U;
  if (!append_wide(stream, PATH_MAX_UNITS + 32U, &cursor, path) ||
      !append_wide(stream, PATH_MAX_UNITS + 32U, &cursor,
                   L":fixture:$DATA"))
    return 0;
  file = CreateFileW(stream, GENERIC_WRITE, FILE_SHARE_READ, NULL,
                     CREATE_NEW, FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) return 0;
  if (!WriteFile(file, &value, 1U, &written, NULL) || written != 1U) {
    (void)CloseHandle(file);
    return 0;
  }
  return CloseHandle(file);
}

static int fixture_execution_remove_stream(const WCHAR *path) {
  WCHAR stream[PATH_MAX_UNITS + 32U];
  DWORD cursor = 0U;
  HANDLE file;
  FILE_DISPOSITION_INFO disposition;
  disposition.DeleteFile = TRUE;
  if (!append_wide(stream, PATH_MAX_UNITS + 32U, &cursor, path) ||
      !append_wide(stream, PATH_MAX_UNITS + 32U, &cursor,
                   L":fixture:$DATA"))
    return 0;
  file = CreateFileW(stream, DELETE, FILE_SHARE_READ, NULL, OPEN_EXISTING,
                     FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT,
                     NULL);
  if (file == INVALID_HANDLE_VALUE) return 0;
  if (!SetFileInformationByHandle(file, FileDispositionInfo, &disposition,
                                  sizeof(disposition)) ||
      !CloseHandle(file))
    return 0;
  return 1;
}

static int fixture_parse_execution_chain(ROOT_CUSTODY *root,
                                         const PROFILE_IDENTITY *identity,
                                         int complete) {
  JOURNAL_GROUP *group = (JOURNAL_GROUP *)HeapAlloc(
      GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*group));
  int valid = 0;
  if (group == NULL) return 0;
  copy_bytes(group->identity.token, identity->token, TOKEN_BYTES);
  copy_bytes(group->profile_created_digest, identity->prior_digest, 32U);
  if (!parse_execution_record(root, group, EXECUTION_ATTEMPTED) ||
      (complete &&
       !parse_execution_record(root, group, EXECUTION_CREATED)) ||
      !parse_execution_record(root, group, EXECUTION_DELETE_ATTEMPTED) ||
      !parse_execution_record(root, group, EXECUTION_ABSENCE_PROVED) ||
      group->execution == NULL ||
      group->execution->phase != EXECUTION_ABSENCE_PROVED)
    goto done;
  valid = 1;
done:
  if (group->execution != NULL) {
    if (!release_execution(root, group->execution)) valid = 0;
    if (!HeapFree(GetProcessHeap(), 0U, group->execution)) valid = 0;
  }
  if (!HeapFree(GetProcessHeap(), 0U, group)) valid = 0;
  return valid;
}

static EXECUTION_CUSTODY *fixture_reload_execution(
    ROOT_CUSTODY *root, const PROFILE_IDENTITY *identity) {
  JOURNAL_GROUP *group = (JOURNAL_GROUP *)HeapAlloc(
      GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*group));
  EXECUTION_CUSTODY *execution = NULL;
  if (group == NULL) return NULL;
  copy_bytes(group->identity.token, identity->token, TOKEN_BYTES);
  copy_bytes(group->profile_created_digest, identity->prior_digest, 32U);
  if (!parse_execution_record(root, group, EXECUTION_ATTEMPTED)) goto done;
  for (BYTE kind = EXECUTION_CREATED;
       kind <= EXECUTION_ABSENCE_PROVED; kind += 1U) {
    WCHAR path[1200];
    DWORD attributes;
    if (!execution_journal_path(root, identity->token, kind, 0, path))
      goto done;
    attributes = GetFileAttributesW(path);
    if (attributes == INVALID_FILE_ATTRIBUTES) {
      if (GetLastError() != ERROR_FILE_NOT_FOUND &&
          GetLastError() != ERROR_PATH_NOT_FOUND)
        goto done;
      continue;
    }
    if (!parse_execution_record(root, group, kind)) goto done;
  }
  execution = group->execution;
  group->execution = NULL;
done:
  if (group->execution != NULL) {
    (void)release_execution(root, group->execution);
    (void)HeapFree(GetProcessHeap(), 0U, group->execution);
  }
  if (!HeapFree(GetProcessHeap(), 0U, group)) return NULL;
  return execution;
}

static int fixture_execution_record_mutants(
    ROOT_CUSTODY *root, const PROFILE_IDENTITY *identity,
    const EXECUTION_CUSTODY *template_execution) {
  EXECUTION_CUSTODY *execution = (EXECUTION_CUSTODY *)HeapAlloc(
      GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*execution));
  BYTE *record = (BYTE *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, 4096U);
  int valid = 0;
  if (execution == NULL || record == NULL) goto done;
  copy_bytes(execution, template_execution, sizeof(*execution));
  execution->phase = 0U;
  zero_bytes(execution->root_binding, 32U);
  zero_bytes(execution->target_bindings, 96U);
  if (execution_record(root, identity, execution, EXECUTION_ATTEMPTED,
                       record, 4096U) == 0U)
    goto done;
  execution->target_bindings[0][0] = 1U;
  if (execution_record(root, identity, execution, EXECUTION_ATTEMPTED,
                       record, 4096U) != 0U)
    goto done;
  execution->phase = EXECUTION_ATTEMPTED;
  execution->root_binding[0] = 1U;
  for (BYTE role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U)
    execution->target_bindings[role][0] = (BYTE)(role + 1U);
  if (execution_record(root, identity, execution, EXECUTION_CREATED,
                       record, 4096U) == 0U)
    goto done;
  for (BYTE role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U) {
    BYTE retained = execution->target_bindings[role][0];
    execution->target_bindings[role][0] = 0U;
    if (execution_record(root, identity, execution, EXECUTION_CREATED,
                         record, 4096U) != 0U)
      goto done;
    execution->target_bindings[role][0] = retained;
  }
  execution->phase = EXECUTION_ATTEMPTED;
  if (execution_record(root, identity, execution,
                       EXECUTION_DELETE_ATTEMPTED, record, 4096U) != 0U)
    goto done;
  execution->phase = EXECUTION_CREATED;
  zero_bytes(execution->root_binding, 32U);
  zero_bytes(execution->target_bindings, 96U);
  if (execution_record(root, identity, execution,
                       EXECUTION_DELETE_ATTEMPTED, record, 4096U) != 0U)
    goto done;
  valid = 1;
done:
  if (record != NULL && !HeapFree(GetProcessHeap(), 0U, record)) valid = 0;
  if (execution != NULL &&
      !HeapFree(GetProcessHeap(), 0U, execution))
    valid = 0;
  return valid;
}

static int fixture_reject_corrupt_absence(ROOT_CUSTODY *root,
                                          const PROFILE_IDENTITY *identity) {
  WCHAR path[1200];
  BYTE *record = NULL;
  DWORD length = 0U;
  DWORD cursor = 140U;
  WORD parent_units;
  WORD root_units;
  HANDLE file = INVALID_HANDLE_VALUE;
  DWORD written = 0U;
  JOURNAL_GROUP *group = NULL;
  int valid = 0;
  if (!execution_journal_path(root, identity->token,
                              EXECUTION_ABSENCE_PROVED, 0, path) ||
      !load_record(root, path, &record, &length) || cursor + 2U > length)
    goto done;
  parent_units = read_u16(record + cursor);
  cursor += 2U + (DWORD)parent_units * 2U + 32U;
  if (cursor + 2U > length) goto done;
  root_units = read_u16(record + cursor);
  cursor += 2U + (DWORD)root_units * 2U + 96U;
  if (cursor + 32U + 96U != length) goto done;
  zero_bytes(record + cursor, 32U);
  file = CreateFileW(path, GENERIC_WRITE | SYNCHRONIZE, 0U, NULL,
                     OPEN_EXISTING,
                     FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH |
                         FILE_FLAG_OPEN_REPARSE_POINT,
                     NULL);
  SetLastError(ERROR_SUCCESS);
  if (file == INVALID_HANDLE_VALUE ||
      (SetFilePointer(file, 0, NULL, FILE_BEGIN) == INVALID_SET_FILE_POINTER &&
       GetLastError() != ERROR_SUCCESS) ||
      !WriteFile(file, record, length, &written, NULL) || written != length ||
      !FlushFileBuffers(file) || !CloseHandle(file))
    goto done;
  file = INVALID_HANDLE_VALUE;
  group = (JOURNAL_GROUP *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY,
                                     sizeof(*group));
  if (group == NULL) goto done;
  copy_bytes(group->identity.token, identity->token, TOKEN_BYTES);
  copy_bytes(group->profile_created_digest, identity->prior_digest, 32U);
  if (!parse_execution_record(root, group, EXECUTION_ATTEMPTED) ||
      !parse_execution_record(root, group, EXECUTION_CREATED) ||
      !parse_execution_record(root, group, EXECUTION_DELETE_ATTEMPTED) ||
      parse_execution_record(root, group, EXECUTION_ABSENCE_PROVED) != 0)
    goto done;
  valid = 1;
done:
  if (file != INVALID_HANDLE_VALUE && !CloseHandle(file)) valid = 0;
  if (record != NULL && !HeapFree(GetProcessHeap(), 0U, record)) valid = 0;
  if (group != NULL) {
    if (group->execution != NULL) {
      if (!release_execution(root, group->execution)) valid = 0;
      if (!HeapFree(GetProcessHeap(), 0U, group->execution)) valid = 0;
    }
    if (!HeapFree(GetProcessHeap(), 0U, group)) valid = 0;
  }
  return valid;
}

static int fixture_execution_expected(void) {
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  BROKER_FRAME frame;
  EXECUTION_PREPARE_PATHS *paths;
  ROOT_CUSTODY root;
  PROFILE_IDENTITY identity;
  EXECUTION_CUSTODY *execution;
  BYTE trailing;
  DWORD index;
  int retained;
  int constructed;
  int cleaned = 0;
  int released;
  paths = (EXECUTION_PREPARE_PATHS *)HeapAlloc(
      GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*paths));
  execution = (EXECUTION_CUSTODY *)HeapAlloc(
      GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*execution));
  if (paths == NULL || execution == NULL || input == NULL ||
      input == INVALID_HANDLE_VALUE ||
      !read_one(input, &fixture_execution_case) ||
      fixture_execution_case < 1U || fixture_execution_case > 41U ||
      read_frame(input, &frame, 1) != 1 ||
      frame.operation != PREPARE_OPERATION ||
      !canonical_execution_prepare(frame.payload, frame.length, paths) ||
      read_one(input, &trailing) != 0)
    return 0;
  zero_bytes(&root, sizeof(root));
  zero_bytes(&identity, sizeof(identity));
  if (!retain_root(paths->state_root, paths->state_root_units, &root)) {
    (void)release_root(&root);
    return 0;
  }
  for (index = 0U; index < TOKEN_BYTES; index += 1U)
    identity.token[index] = (BYTE)(index + 1U);
  for (index = 0U; index < 32U; index += 1U)
    identity.prior_digest[index] = (BYTE)(0x80U + index);
  identity.phase = JOURNAL_PROFILE_CREATED;
  if (fixture_execution_case == 4U &&
      !fixture_execution_stream(paths->execution_parent)) {
    (void)release_root(&root);
    return 0;
  }
  if (fixture_execution_case == 5U &&
      !fixture_execution_stream(paths->sources[0])) {
    (void)release_root(&root);
    return 0;
  }
  if (fixture_execution_case == 8U || fixture_execution_case == 40U)
    fixture_execution_find_close_target = 1U;
  if (fixture_execution_case == 9U)
    fixture_execution_find_close_target = 2U;
  retained = retain_execution_inputs(&root, paths, &identity, execution);
  if (fixture_execution_case == 8U || fixture_execution_case == 9U ||
      fixture_execution_case == 40U) {
    int ambiguous = root.resource_ambiguous;
    int execution_released = release_execution(&root, execution);
    int root_released = release_root(&root);
    int execution_freed = HeapFree(GetProcessHeap(), 0U, execution);
    int paths_freed = HeapFree(GetProcessHeap(), 0U, paths);
    return !retained && ambiguous &&
           ((fixture_execution_case == 40U && !execution_released) ||
            (fixture_execution_case != 40U && execution_released)) &&
           !root_released && execution_freed && paths_freed;
  }
  if (fixture_execution_case == 4U || fixture_execution_case == 5U) {
    released = release_execution(&root, execution) && release_root(&root) &&
               HeapFree(GetProcessHeap(), 0U, execution) &&
               HeapFree(GetProcessHeap(), 0U, paths);
    return !retained && released;
  }
  if (!retained) {
    (void)release_execution(&root, execution);
    (void)release_root(&root);
    return 0;
  }
  if (!fixture_execution_record_mutants(&root, &identity, execution)) {
    (void)release_execution(&root, execution);
    (void)release_root(&root);
    return 0;
  }
  if (fixture_execution_case == 7U &&
      !SetFileAttributesW(paths->sources[0], 0x2U)) {
    (void)release_execution(&root, execution);
    (void)release_root(&root);
    return 0;
  }
  constructed = construct_execution(&root, &identity, execution);
  if (fixture_execution_case == 36U || fixture_execution_case == 37U) {
    int ambiguous = root.resource_ambiguous;
    BYTE stopped_phase = execution->phase;
    int execution_released = release_execution(&root, execution);
    int root_released = release_root(&root);
    int execution_freed = HeapFree(GetProcessHeap(), 0U, execution);
    int paths_freed = HeapFree(GetProcessHeap(), 0U, paths);
    return !constructed && ambiguous &&
           stopped_phase == EXECUTION_ATTEMPTED && execution_released &&
           !root_released && execution_freed && paths_freed;
  }
  if (fixture_execution_case == 7U) {
    BYTE stopped_phase = execution->phase;
    released = release_execution(&root, execution) && release_root(&root) &&
               HeapFree(GetProcessHeap(), 0U, execution) &&
               HeapFree(GetProcessHeap(), 0U, paths);
    return !constructed && stopped_phase == 0U && released;
  }
  if (fixture_execution_case == 6U) {
    BYTE stopped_phase = execution->phase;
    WCHAR root_path[PATH_MAX_UNITS + 1U];
    WORD root_units = execution->root.path_units;
    copy_bytes(root_path, execution->root.path,
               ((DWORD)execution->root.path_units + 1U) * 2U);
    if (constructed || stopped_phase != EXECUTION_ATTEMPTED ||
        fixture_execution_product_deletes != 0U ||
        !release_retained_object(&root, &execution->root) ||
        !fixture_execution_remove_stream(root_path))
      goto done;
    execution->root.path_units = root_units;
    copy_bytes(execution->root.path, root_path,
               ((DWORD)root_units + 1U) * 2U);
    fixture_execution_reset_delete_order();
    fixture_execution_count_deletes = 1;
    cleaned = cleanup_execution(&root, &identity, execution);
    fixture_execution_count_deletes = 0;
    if (!cleaned || execution->phase != EXECUTION_ABSENCE_PROVED ||
        fixture_execution_product_deletes == 0U ||
        !fixture_execution_exact_delete_order((BYTE[1]){4U}, 1U) ||
        !fixture_parse_execution_chain(&root, &identity, 0))
      cleaned = 0;
    goto done;
  }
  if (fixture_execution_case == 41U) {
    BYTE first_delete[] = {1U};
    BYTE remaining_deletes[] = {2U, 3U, 4U};
    WCHAR absent_path[PATH_MAX_UNITS + 1U];
    WORD absent_units;
    int ambiguous;
    if (!constructed || execution->phase != EXECUTION_CREATED ||
        !persist_execution_phase(&root, &identity, execution,
                                 EXECUTION_DELETE_ATTEMPTED) ||
        !execution_target_path(&execution->root, 0U, absent_path,
                               &absent_units))
      goto done;
    fixture_execution_reset_delete_order();
    fixture_execution_count_deletes = 1;
    cleaned = delete_retained_object(&root, &execution->targets[0]);
    fixture_execution_count_deletes = 0;
    if (!cleaned ||
        !fixture_execution_exact_delete_order(first_delete, 1U) ||
        GetFileAttributesW(absent_path) != INVALID_FILE_ATTRIBUTES ||
        (GetLastError() != ERROR_FILE_NOT_FOUND &&
         GetLastError() != ERROR_PATH_NOT_FOUND))
      goto done;
    if (!release_execution(&root, execution) ||
        !HeapFree(GetProcessHeap(), 0U, execution))
      goto done_without_execution;
    execution = fixture_reload_execution(&root, &identity);
    if (execution == NULL ||
        execution->phase != EXECUTION_DELETE_ATTEMPTED)
      goto done_without_execution;
    fixture_execution_track_recovery_opens = 1;
    fixture_execution_cleanup_find_close = 1;
    fixture_execution_reset_delete_order();
    fixture_execution_count_deletes = 1;
    cleaned = cleanup_execution(&root, &identity, execution);
    fixture_execution_count_deletes = 0;
    ambiguous = root.resource_ambiguous;
    if (cleaned || !ambiguous || fixture_execution_product_deletes != 1U ||
        fixture_execution_delete_order_count != 0U ||
        fixture_execution_unidentified_delete)
      goto done;
    root.resource_ambiguous = 0;
    if (!release_execution(&root, execution) ||
        !HeapFree(GetProcessHeap(), 0U, execution))
      goto done_without_execution;
    execution = fixture_reload_execution(&root, &identity);
    if (execution == NULL ||
        execution->phase != EXECUTION_DELETE_ATTEMPTED)
      goto done_without_execution;
    fixture_execution_reset_delete_order();
    fixture_execution_count_deletes = 1;
    cleaned = cleanup_execution(&root, &identity, execution);
    fixture_execution_count_deletes = 0;
    fixture_execution_track_recovery_opens = 0;
    if (!cleaned || execution->phase != EXECUTION_ABSENCE_PROVED ||
        fixture_execution_target_opens[0] != 0U ||
        fixture_execution_target_opens[1] == 0U ||
        fixture_execution_target_opens[2] == 0U ||
        !fixture_execution_exact_delete_order(remaining_deletes, 3U) ||
        !fixture_parse_execution_chain(&root, &identity, 1))
      cleaned = 0;
    goto done;
  }
  if (fixture_execution_case >= 10U) {
    BYTE fault_phase;
    BYTE fault_point;
    int complete = fixture_execution_case == 34U ||
                   fixture_execution_case == 35U ||
                   fixture_execution_case == 39U;
    int bad_delete_order;
    if ((complete && (!constructed || execution->phase != EXECUTION_CREATED)) ||
        (!complete &&
         (constructed || execution->phase != EXECUTION_ATTEMPTED)))
      goto done;
    fixture_execution_stage = 1U;
    if (fixture_execution_case == 38U || fixture_execution_case == 39U) {
      int ambiguous;
      fixture_execution_reset_delete_order();
      fixture_execution_cleanup_find_close = 1;
      fixture_execution_count_deletes = 1;
      cleaned = cleanup_execution(&root, &identity, execution);
      fixture_execution_count_deletes = 0;
      ambiguous = root.resource_ambiguous;
      if (cleaned || !ambiguous || fixture_execution_product_deletes != 0U ||
          fixture_execution_delete_order_count != 0U ||
          fixture_execution_unidentified_delete)
        goto done;
      root.resource_ambiguous = 0;
      fixture_execution_reset_delete_order();
      fixture_execution_count_deletes = 1;
      cleaned = cleanup_execution(&root, &identity, execution);
      fixture_execution_count_deletes = 0;
      if (!cleaned || execution->phase != EXECUTION_ABSENCE_PROVED ||
          (complete &&
           !fixture_execution_exact_delete_order(
               (BYTE[4]){1U, 2U, 3U, 4U}, 4U)) ||
          (!complete &&
           !fixture_execution_exact_delete_order((BYTE[1]){4U}, 1U)) ||
          !fixture_parse_execution_chain(&root, &identity, complete))
        cleaned = 0;
      goto done;
    } else if (fixture_execution_case <= 21U) {
      fault_phase = EXECUTION_DELETE_ATTEMPTED;
      fault_point = (BYTE)(fixture_execution_case - 9U);
    } else if (fixture_execution_case <= 33U) {
      fault_phase = EXECUTION_ABSENCE_PROVED;
      fault_point = (BYTE)(fixture_execution_case - 21U);
    } else {
      fault_phase = fixture_execution_case == 34U ?
          EXECUTION_DELETE_ATTEMPTED : EXECUTION_ABSENCE_PROVED;
      fault_point = 1U;
    }
    fixture_execution_fault_phase = fault_phase;
    fixture_execution_fault_point = fault_point;
    fixture_execution_state_handle = root.handle;
    fixture_execution_fault_active = 1;
    fixture_execution_reset_delete_order();
    fixture_execution_count_deletes = 1;
    cleaned = cleanup_execution(&root, &identity, execution);
    fixture_execution_count_deletes = 0;
    fixture_execution_fault_active = 0;
    bad_delete_order = fault_phase == EXECUTION_DELETE_ATTEMPTED
        ? fixture_execution_product_deletes != 0U ||
              fixture_execution_delete_order_count != 0U ||
              fixture_execution_unidentified_delete
        : fixture_execution_product_deletes == 0U ||
              (complete
                   ? !fixture_execution_exact_delete_order(
                         (BYTE[4]){1U, 2U, 3U, 4U}, 4U)
                   : !fixture_execution_exact_delete_order(
                         (BYTE[1]){4U}, 1U));
    if (cleaned || bad_delete_order)
      goto done;
    fixture_execution_stage = 2U;
    root.resource_ambiguous = 0;
    if (!release_execution(&root, execution) ||
        !HeapFree(GetProcessHeap(), 0U, execution))
      goto done_without_execution;
    execution = fixture_reload_execution(&root, &identity);
    if (execution == NULL) goto done_without_execution;
    fixture_execution_stage = 3U;
    fixture_execution_reset_delete_order();
    fixture_execution_count_deletes = 1;
    cleaned = execution->phase == EXECUTION_ABSENCE_PROVED ||
              cleanup_execution(&root, &identity, execution);
    fixture_execution_count_deletes = 0;
    if (!cleaned || execution->phase != EXECUTION_ABSENCE_PROVED ||
        (fault_phase == EXECUTION_DELETE_ATTEMPTED && complete &&
         !fixture_execution_exact_delete_order(
             (BYTE[4]){1U, 2U, 3U, 4U}, 4U)) ||
        (fault_phase == EXECUTION_DELETE_ATTEMPTED && !complete &&
         !fixture_execution_exact_delete_order((BYTE[1]){4U}, 1U)) ||
        (fault_phase == EXECUTION_ABSENCE_PROVED &&
         (fixture_execution_delete_order_count != 0U ||
          fixture_execution_unidentified_delete)))
      goto done;
    fixture_execution_stage = 4U;
    if (!fixture_parse_execution_chain(&root, &identity, complete))
      cleaned = 0;
    fixture_execution_stage = 5U;
    goto done;
  }
  if (fixture_execution_case == 1U) {
    if (!constructed || execution->phase != EXECUTION_CREATED)
      goto done;
  } else if (constructed || execution->phase != EXECUTION_ATTEMPTED) {
    goto done;
  }
  fixture_execution_reset_delete_order();
  fixture_execution_count_deletes = 1;
  cleaned = cleanup_execution(&root, &identity, execution);
  fixture_execution_count_deletes = 0;
  if (cleaned &&
      ((fixture_execution_case == 1U &&
        !fixture_execution_exact_delete_order(
            (BYTE[4]){1U, 2U, 3U, 4U}, 4U)) ||
       (fixture_execution_case == 2U &&
        !fixture_execution_exact_delete_order((BYTE[1]){4U}, 1U)) ||
       (fixture_execution_case == 3U &&
        !fixture_execution_exact_delete_order((BYTE[2]){1U, 4U}, 2U)))) {
    diagnostic("fixture:execution-delete-order\n");
    cleaned = 0;
  }
  if (!cleaned || execution->phase != EXECUTION_ABSENCE_PROVED ||
      GetFileAttributesW(execution->root.path) != INVALID_FILE_ATTRIBUTES ||
      (GetLastError() != ERROR_FILE_NOT_FOUND &&
       GetLastError() != ERROR_PATH_NOT_FOUND) ||
      !directory_empty(&root, &execution->parent))
    cleaned = 0;
  if (cleaned &&
      !fixture_parse_execution_chain(&root, &identity,
                                     fixture_execution_case == 1U))
    cleaned = 0;
  if (cleaned && fixture_execution_case == 1U &&
      !fixture_reject_corrupt_absence(&root, &identity))
    cleaned = 0;
done:
  released = release_execution(&root, execution) && release_root(&root) &&
             HeapFree(GetProcessHeap(), 0U, execution) &&
             HeapFree(GetProcessHeap(), 0U, paths);
  if ((!cleaned || !released) && fixture_execution_case >= 10U) {
    static const CHAR *messages[] = {
      "", "fixture:execution-cleanup-stage-1\n",
      "fixture:execution-cleanup-stage-2\n",
      "fixture:execution-cleanup-stage-3\n",
      "fixture:execution-cleanup-stage-4\n",
      "fixture:execution-cleanup-stage-5\n"
    };
    diagnostic(messages[fixture_execution_stage]);
  }
  return cleaned && released;
done_without_execution:
  released = release_root(&root) &&
             HeapFree(GetProcessHeap(), 0U, paths);
  (void)released;
  return 0;
}

__declspec(noreturn) void fixture_entry(void) {
  ExitProcess(fixture_execution_expected() ? 0U : 1U);
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
#define FIXTURE_FAULT_EXECUTION_PUBLICATION 33U
#define FIXTURE_LIFECYCLE_EXECUTION_CLEANUP_FAILURE 34U
#define FIXTURE_FAULT_ADMISSION_PUBLICATION 35U
#define FIXTURE_LIFECYCLE_ADMISSION_AMBIGUOUS 36U
#define FIXTURE_LIFECYCLE_ADMISSION_REFUSED 37U

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
static BYTE fixture_fault_family;
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

static BYTE fixture_path_phase(PCWSTR path, int *pending, BYTE *family) {
  static const WCHAR *endings[] = {
    L"", L"-00-used.opwj", L"-01-profile-attempted.opwj",
    L"-02-profile-created.opwj", L"-03-profile-delete-attempted.opwj",
    L"-04-profile-absence-proved.opwj"
  };
  SIZE_T path_units = wide_length(path);
  *pending = 0;
  *family = 0U;
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
  {
    static const WCHAR *execution_endings[] = {
      L"", L"-00-attempted.opwx", L"-01-created.opwx",
      L"-02-delete-attempted.opwx", L"-03-absence-proved.opwx"
    };
    for (BYTE kind = EXECUTION_ATTEMPTED;
         kind <= EXECUTION_ABSENCE_PROVED; kind += 1U) {
      SIZE_T ending_units = wide_length(execution_endings[kind]);
      if (path_units >= ending_units &&
          fixture_wide_units_equal(path + path_units - ending_units,
                                   execution_endings[kind], ending_units)) {
        *family = 1U;
        return kind;
      }
      if (path_units >= ending_units + 8U &&
          wide_equal(path + path_units - 8U, L".pending") &&
          fixture_wide_units_equal(path + path_units - ending_units - 8U,
                                   execution_endings[kind], ending_units)) {
        *pending = 1;
        *family = 1U;
        return kind;
      }
    }
  }
  {
    static const WCHAR *admission_endings[] = {
      L"", L"-00-grant-attempted.opwl", L"-01-granted.opwl",
      L"-02-job-attempted.opwl", L"-03-launch-attempted.opwl",
      L"-04-admission-proved.opwl", L"-05-revoke-attempted.opwl",
      L"-06-absence-proved.opwl"
    };
    for (BYTE kind = ADMISSION_GRANT_ATTEMPTED;
         kind <= ADMISSION_ABSENCE_PROVED; kind += 1U) {
      SIZE_T ending_units = wide_length(admission_endings[kind]);
      if (path_units >= ending_units &&
          fixture_wide_units_equal(path + path_units - ending_units,
                                   admission_endings[kind], ending_units)) {
        *family = 2U;
        return kind;
      }
      if (path_units >= ending_units + 8U &&
          wide_equal(path + path_units - 8U, L".pending") &&
          fixture_wide_units_equal(path + path_units - ending_units - 8U,
                                   admission_endings[kind], ending_units)) {
        *pending = 1;
        *family = 2U;
        return kind;
      }
    }
  }
  return 0U;
}

static HANDLE WINAPI fixture_CreateFileW(PCWSTR path, DWORD access, DWORD sharing,
                                         SECURITY_ATTRIBUTES *attributes, DWORD creation,
                                         DWORD flags, HANDLE template_file) {
  int pending = 0;
  BYTE family = 0U;
  BYTE phase = fixture_path_phase(path, &pending, &family);
  HANDLE result;
  if (fixture_fault_active && family == fixture_fault_family &&
      phase == fixture_fault_phase && pending &&
      creation == CREATE_NEW && fixture_fault_point == FAULT_PENDING_CREATE) {
    SetLastError(5U);
    return INVALID_HANDLE_VALUE;
  }
  if (fixture_fault_active && family == fixture_fault_family &&
      phase == fixture_fault_phase && !pending &&
      creation == OPEN_EXISTING && fixture_fault_point == FAULT_FINAL_REOPEN) {
    SetLastError(5U);
    return INVALID_HANDLE_VALUE;
  }
  result = CreateFileW(path, access, sharing, attributes, creation, flags, template_file);
  if (result != INVALID_HANDLE_VALUE && family == fixture_fault_family &&
      phase == fixture_fault_phase) {
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
  BYTE family = 0U;
  BYTE phase = fixture_path_phase(path, &pending, &family);
  if (fixture_fault_active && family == fixture_fault_family &&
      phase == fixture_fault_phase && pending &&
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
    L"fault-resources", L"profile-control", L"mixed-recovery", L"substitution",
    L"fault-execution-publication", L"lifecycle-execution-cleanup-failure",
    L"fault-admission-publication", L"lifecycle-admission-ambiguous",
    L"lifecycle-admission-refused"
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
        !canonical_scope_path(frame.payload, frame.length, path, &path_units)) {
      return 0;
    }
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
  if (fixture_scenario == FIXTURE_FAULT_ADMISSION_PUBLICATION) {
    BYTE configuration[3];
    BROKER_FRAME frame;
    WCHAR path[PATH_MAX_UNITS + 1U];
    WORD path_units = 0U;
    PROFILE_IDENTITY identity;
    EXECUTION_CUSTODY *execution = NULL;
    ADMISSION_CUSTODY admission;
    JOURNAL_GROUP *observed = NULL;
    DWORD observed_count = 0U;
    DWORD cursor = 0U;
    WCHAR token_hex[65];
    BYTE predecessor;
    BYTE target;
    BYTE fault;
    int valid = 0;
    BYTE stage = 1U;
    static const WCHAR folder[] = L"\\\\?\\C:\\fixture-profile";
    if (!read_exact(GetStdHandle(STD_INPUT_HANDLE), configuration,
                    sizeof(configuration)) ||
        read_frame(GetStdHandle(STD_INPUT_HANDLE), &frame, 1) != 1 ||
        frame.operation != PREPARE_OPERATION ||
        !canonical_scope_path(frame.payload, frame.length, path, &path_units))
      return 0;
    predecessor = configuration[0];
    target = configuration[1];
    fault = configuration[2];
    if (target < ADMISSION_GRANT_ATTEMPTED ||
        target > ADMISSION_ABSENCE_PROVED ||
        fault < FAULT_PENDING_CREATE || fault > FAULT_PRIOR_PARSE ||
        !valid_admission_transition(predecessor, target))
      return 0;
    zero_bytes(&admission, sizeof(admission));
    execution = (EXECUTION_CUSTODY *)HeapAlloc(
        GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*execution));
    stage = 2U;
    if (execution == NULL || !retain_root(path, path_units, &root) ||
        !identity_for_token(&root, (BYTE[32]){8U}, &identity) ||
        !persist_phase(&root, &identity, JOURNAL_USED) ||
        !persist_phase(&root, &identity, JOURNAL_PROFILE_ATTEMPTED))
      goto admission_fault_done;
    identity.folder_units = (WORD)wide_length(folder);
    copy_bytes(identity.folder, folder,
               ((DWORD)identity.folder_units + 1U) * 2U);
    identity.folder_binding[0] = 1U;
    if (!persist_phase(&root, &identity, JOURNAL_PROFILE_CREATED))
      goto admission_fault_done;
    copy_bytes(execution->profile_created_digest, identity.prior_digest, 32U);
    if (!append_wide(execution->parent.path, PATH_MAX_UNITS + 1U, &cursor,
                     L"\\\\?\\C:\\fixture-admission-parent"))
      goto admission_fault_done;
    execution->parent.path_units = (WORD)cursor;
    execution->parent.binding[0] = 1U;
    cursor = 0U;
    hex_token(identity.token, token_hex);
    if (!append_wide(execution->root.path, PATH_MAX_UNITS + 1U, &cursor,
                     L"\\\\?\\C:\\fixture-admission-parent\\orch6-execution-") ||
        !append_wide(execution->root.path, PATH_MAX_UNITS + 1U, &cursor,
                     token_hex))
      goto admission_fault_done;
    execution->root.path_units = (WORD)cursor;
    for (BYTE role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U)
      execution->source_bindings[role][0] = (BYTE)(role + 1U);
    if (!persist_execution_phase(&root, &identity, execution,
                                 EXECUTION_ATTEMPTED))
      goto admission_fault_done;
    execution->root_binding[0] = 1U;
    for (BYTE role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U)
      execution->target_bindings[role][0] = (BYTE)(role + 1U);
    if (!persist_execution_phase(&root, &identity, execution,
                                 EXECUTION_CREATED) ||
        !admission_job_name(identity.token, admission.job_name,
                            &admission.job_name_units))
      goto admission_fault_done;
    copy_bytes(admission.profile_created_digest,
               execution->profile_created_digest, 32U);
    copy_bytes(admission.execution_created_digest,
               execution->prior_digest, 32U);
    admission.grant_digest[0] = 1U;
    admission.launch_digest[0] = 2U;
    stage = 3U;
    if (predecessor <= ADMISSION_PROVED) {
      for (BYTE kind = ADMISSION_GRANT_ATTEMPTED;
           kind <= predecessor; kind += 1U)
        if (!persist_admission_phase(&root, &identity, &admission, kind))
          goto admission_fault_done;
    } else {
      for (BYTE kind = ADMISSION_GRANT_ATTEMPTED;
           kind <= ADMISSION_PROVED; kind += 1U)
        if (!persist_admission_phase(&root, &identity, &admission, kind))
          goto admission_fault_done;
      if (!persist_admission_phase(&root, &identity, &admission,
                                   ADMISSION_REVOKE_ATTEMPTED))
        goto admission_fault_done;
    }
    fixture_fault_family = 2U;
    fixture_fault_phase = target;
    fixture_fault_point = fault;
    fixture_fault_root_handle = root.handle;
    fixture_fault_token_handle = root.token;
    fixture_fault_pending_handle = NULL;
    fixture_fault_record_handle = NULL;
    stage = 4U;
    if (fault == FAULT_PRIOR_PARSE) {
      if (!persist_admission_phase(&root, &identity, &admission, target))
        goto admission_fault_done;
      fixture_fault_active = 1U;
      if (scan_journals(&root, &observed, &observed_count) != -1)
        goto admission_fault_done;
      fixture_fault_active = 0U;
      if (observed != NULL) {
        if (!HeapFree(GetProcessHeap(), 0U, observed))
          goto admission_fault_done;
        observed = NULL;
      }
    } else {
      fixture_fault_active = 1U;
      if (persist_admission_phase(&root, &identity, &admission, target) != 0)
        goto admission_fault_done;
      fixture_fault_active = 0U;
    }
    root.resource_ambiguous = 0;
    if (!release_root(&root) || !retain_root(path, path_units, &root))
      goto admission_fault_done;
    fixture_fault_root_handle = root.handle;
    fixture_fault_token_handle = root.token;
    stage = 5U;
    if (scan_journals(&root, &observed, &observed_count) != 1 ||
        observed_count != 1U ||
        (observed[0].admission.phase != predecessor &&
         observed[0].admission.phase != target))
      goto admission_fault_done;
    copy_bytes(&identity, &observed[0].identity, sizeof(identity));
    if (observed[0].admission.phase != 0U)
      copy_bytes(&admission, &observed[0].admission, sizeof(admission));
    if (!clear_admission_pending(&root, &identity))
      goto admission_fault_done;
    if (!HeapFree(GetProcessHeap(), 0U, observed))
      goto admission_fault_done;
    observed = NULL;
    stage = 6U;
    if (admission.phase == predecessor &&
        !persist_admission_phase(&root, &identity, &admission, target))
      goto admission_fault_done;
    stage = 7U;
    if (scan_journals(&root, &observed, &observed_count) != 1 ||
        observed_count != 1U || observed[0].admission.phase != target)
      goto admission_fault_done;
    stage = 8U;
    valid = 1;
admission_fault_done:
    fixture_fault_active = 0U;
    root.resource_ambiguous = 0;
    if (observed != NULL && !HeapFree(GetProcessHeap(), 0U, observed))
      valid = 0;
    if (execution != NULL &&
        !HeapFree(GetProcessHeap(), 0U, execution))
      valid = 0;
    if (root.handle != NULL && !release_root(&root)) valid = 0;
    if (!valid) {
      static const CHAR *messages[] = {
        "", "fixture:admission-fault-stage-1\n",
        "fixture:admission-fault-stage-2\n",
        "fixture:admission-fault-stage-3\n",
        "fixture:admission-fault-stage-4\n",
        "fixture:admission-fault-stage-5\n",
        "fixture:admission-fault-stage-6\n",
        "fixture:admission-fault-stage-7\n",
        "fixture:admission-fault-stage-8\n"
      };
      diagnostic(messages[stage]);
    }
    return valid;
  }
  if (fixture_scenario == FIXTURE_FAULT_EXECUTION_PUBLICATION) {
    BYTE configuration[2];
    BROKER_FRAME frame;
    WCHAR path[PATH_MAX_UNITS + 1U];
    WORD path_units = 0U;
    PROFILE_IDENTITY identity;
    EXECUTION_CUSTODY *execution = NULL;
    WCHAR pending[1200];
    DWORD cursor = 0U;
    int valid = 0;
    BYTE stage = 1U;
    if (!read_exact(GetStdHandle(STD_INPUT_HANDLE), configuration,
                    sizeof(configuration))) {
      diagnostic("fixture:execution-fault-input-read\n");
      return 0;
    }
    if (configuration[0] < EXECUTION_ATTEMPTED ||
        configuration[0] > EXECUTION_ABSENCE_PROVED ||
        configuration[1] < FAULT_PENDING_CREATE ||
        configuration[1] > FAULT_FINAL_REOPEN) {
      diagnostic("fixture:execution-fault-input-config\n");
      return 0;
    }
    if (read_frame(GetStdHandle(STD_INPUT_HANDLE), &frame, 1) != 1) {
      diagnostic("fixture:execution-fault-input-frame\n");
      return 0;
    }
    if (frame.operation != PREPARE_OPERATION) {
      diagnostic("fixture:execution-fault-input-operation\n");
      return 0;
    }
    if (!canonical_scope_path(frame.payload, frame.length, path, &path_units)) {
      diagnostic("fixture:execution-fault-input-scope\n");
      return 0;
    }
    execution = (EXECUTION_CUSTODY *)HeapAlloc(
        GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*execution));
    stage = 2U;
    if (execution == NULL || !retain_root(path, path_units, &root) ||
        !identity_for_token(&root, (BYTE[32]){7U}, &identity))
      goto execution_fault_done;
    identity.phase = JOURNAL_PROFILE_CREATED;
    for (BYTE index = 0U; index < 32U; index += 1U)
      identity.prior_digest[index] = (BYTE)(0x40U + index);
    copy_bytes(execution->profile_created_digest, identity.prior_digest, 32U);
    stage = 3U;
    if (!append_wide(execution->parent.path, PATH_MAX_UNITS + 1U, &cursor,
                     L"\\\\?\\C:\\fixture-execution-parent"))
      goto execution_fault_done;
    execution->parent.path_units = (WORD)cursor;
    execution->parent.binding[0] = 1U;
    cursor = 0U;
    if (!append_wide(execution->root.path, PATH_MAX_UNITS + 1U, &cursor,
                     L"\\\\?\\C:\\fixture-execution-parent\\orch6-execution-") ||
        !append_wide(execution->root.path, PATH_MAX_UNITS + 1U, &cursor,
                     L"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"))
      goto execution_fault_done;
    execution->root.path_units = (WORD)cursor;
    for (BYTE role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U)
      execution->source_bindings[role][0] = (BYTE)(role + 1U);
    fixture_fault_root_handle = root.handle;
    fixture_fault_token_handle = root.token;
    for (BYTE kind = EXECUTION_ATTEMPTED; kind < configuration[0]; kind += 1U) {
      if (kind == EXECUTION_CREATED) {
        execution->root_binding[0] = 1U;
        for (BYTE role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U)
          execution->target_bindings[role][0] = (BYTE)(role + 1U);
      }
      if (!persist_execution_phase(&root, &identity, execution, kind))
        goto execution_fault_done;
    }
    if (configuration[0] == EXECUTION_CREATED) {
      execution->root_binding[0] = 1U;
      for (BYTE role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U)
        execution->target_bindings[role][0] = (BYTE)(role + 1U);
    }
    fixture_fault_phase = configuration[0];
    fixture_fault_point = configuration[1];
    fixture_fault_family = 1U;
    fixture_fault_active = 1U;
    stage = 4U;
    if (persist_execution_phase(&root, &identity, execution,
                                configuration[0]) != 0)
      goto execution_fault_done;
    fixture_fault_active = 0U;
    stage = 5U;
    if (!execution_journal_path(&root, identity.token, configuration[0],
                                1, pending) ||
        GetFileAttributesW(pending) != INVALID_FILE_ATTRIBUTES ||
        (GetLastError() != ERROR_FILE_NOT_FOUND &&
         GetLastError() != ERROR_PATH_NOT_FOUND))
      goto execution_fault_done;
    valid = 1;
    stage = 6U;
execution_fault_done:
    fixture_fault_active = 0U;
    root.resource_ambiguous = 0;
    if (execution != NULL &&
        !HeapFree(GetProcessHeap(), 0U, execution))
      valid = 0;
    if (root.handle != NULL && !release_root(&root)) valid = 0;
    if (!valid) {
      static const CHAR *messages[] = {
        "", "fixture:execution-fault-stage-1\n",
        "fixture:execution-fault-stage-2\n",
        "fixture:execution-fault-stage-3\n",
        "fixture:execution-fault-stage-4\n",
        "fixture:execution-fault-stage-5\n",
        "fixture:execution-fault-stage-6\n"
      };
      diagnostic(messages[stage]);
    }
    return valid;
  }
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
    fixture_fault_family = 0U;
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

static int fixture_retain_execution(ROOT_CUSTODY *root,
                                    const EXECUTION_PREPARE_PATHS *paths,
                                    const PROFILE_IDENTITY *identity,
                                    EXECUTION_CUSTODY *execution) {
  DWORD cursor = 0U;
  (void)root;
  (void)identity;
  zero_bytes(execution, sizeof(*execution));
  if (!append_wide(execution->root.path, PATH_MAX_UNITS + 1U, &cursor,
                   paths->execution_parent) ||
      !append_wide(execution->root.path, PATH_MAX_UNITS + 1U, &cursor,
                   L"\\orch6-execution-fixture"))
    return 0;
  execution->root.path_units = (WORD)cursor;
  return 1;
}

static int fixture_construct_execution(ROOT_CUSTODY *root,
                                       PROFILE_IDENTITY *identity,
                                       EXECUTION_CUSTODY *execution) {
  (void)root;
  (void)identity;
  execution->root_binding[0] = 1U;
  execution->phase = EXECUTION_CREATED;
  return 1;
}

static int fixture_cleanup_execution(ROOT_CUSTODY *root,
                                     PROFILE_IDENTITY *identity,
                                     EXECUTION_CUSTODY *execution) {
  (void)root;
  (void)identity;
  if (fixture_scenario == FIXTURE_LIFECYCLE_EXECUTION_CLEANUP_FAILURE) {
    diagnostic("fixture:cleanup-execution\n");
    return 0;
  }
  execution->phase = EXECUTION_ABSENCE_PROVED;
  return 1;
}

static int fixture_run_admission(ROOT_CUSTODY *root,
                                 PROFILE_IDENTITY *identity,
                                 EXECUTION_CUSTODY *execution) {
  (void)root;
  (void)identity;
  (void)execution;
  diagnostic("fixture:admission\n");
  if (fixture_scenario == FIXTURE_LIFECYCLE_ADMISSION_AMBIGUOUS) return -1;
  return fixture_scenario == FIXTURE_LIFECYCLE_ADMISSION_REFUSED ? 0 : 1;
}

static int fixture_release_execution(ROOT_CUSTODY *root,
                                     EXECUTION_CUSTODY *execution) {
  (void)root;
  zero_bytes(execution, sizeof(*execution));
  return 1;
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
  if (fixture_scenario == FIXTURE_LIFECYCLE_EXECUTION_CLEANUP_FAILURE)
    serve();
  if (fixture_scenario == FIXTURE_LIFECYCLE_ADMISSION_AMBIGUOUS)
    serve();
  if (fixture_scenario == FIXTURE_LIFECYCLE_ADMISSION_REFUSED)
    serve();
  if (fixture_scenario == 0U || fixture_stable_user == NULL || !fixture_expected_result())
    ExitProcess(1U);
  if (!HeapFree(GetProcessHeap(), 0U, fixture_stable_user)) ExitProcess(1U);
  ExitProcess(0U);
}

#endif
