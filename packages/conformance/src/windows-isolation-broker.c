#if !defined(_WIN32)
#error "windows-isolation-broker.c is Windows-only"
#endif
#if !defined(_M_X64) && !defined(__x86_64__)
#error "windows-isolation-broker.c requires X64"
#endif

#if defined(OP_WINDOWS_BROKER_FIXTURE)
#define __declspec(value)
#endif

typedef void *HANDLE;
typedef void *PVOID;
typedef void *LPVOID;
typedef const void *LPCVOID;
typedef unsigned char BYTE;
typedef unsigned char *PUCHAR;
typedef char CHAR;
typedef unsigned short WORD;
typedef unsigned short WCHAR;
typedef WCHAR *PWSTR;
typedef WCHAR *LPWSTR;
typedef const WCHAR *PCWSTR;
typedef unsigned long DWORD;
typedef unsigned long ULONG;
typedef unsigned long long ULONGLONG;
typedef unsigned long long SIZE_T;
typedef long LONG;
typedef long HRESULT;
typedef long NTSTATUS;
typedef int BOOL;
typedef DWORD ACCESS_MASK;
typedef void *PSID;
typedef void *PSECURITY_DESCRIPTOR;
typedef void *BCRYPT_ALG_HANDLE;
typedef void *BCRYPT_HASH_HANDLE;
typedef WORD SECURITY_DESCRIPTOR_CONTROL;
typedef union large_integer {
  struct { DWORD LowPart; LONG HighPart; };
  long long QuadPart;
} LARGE_INTEGER;

#define WINAPI __stdcall
#define NULL ((void *)0)
#define FALSE 0
#define TRUE 1
#define INVALID_HANDLE_VALUE ((HANDLE)(~(SIZE_T)0))
#define INVALID_FILE_ATTRIBUTES ((DWORD)-1)
#define INVALID_SET_FILE_POINTER ((DWORD)-1)
#define FAILED(value) ((HRESULT)(value) < 0)
#define STD_ERROR_HANDLE ((DWORD)-12)
#define STD_INPUT_HANDLE ((DWORD)-10)
#define STD_OUTPUT_HANDLE ((DWORD)-11)
#define ERROR_SUCCESS 0U
#define ERROR_FILE_NOT_FOUND 2U
#define ERROR_PATH_NOT_FOUND 3U
#define ERROR_BROKEN_PIPE 109U
#define ERROR_INSUFFICIENT_BUFFER 122U
#define ERROR_NO_TOKEN 1008U
#define ERROR_NO_MORE_FILES 18U
#define ERROR_HANDLE_EOF 38U
#define HRESULT_ALREADY_EXISTS ((HRESULT)0x800700b7L)
#define HEAP_ZERO_MEMORY 8U
#define TOKEN_QUERY 8U
#define FILE_LIST_DIRECTORY 1U
#define FILE_READ_ATTRIBUTES 0x80U
#define READ_CONTROL 0x00020000U
#define GENERIC_READ 0x80000000U
#define GENERIC_WRITE 0x40000000U
#define GENERIC_ALL 0x10000000U
#define DELETE 0x00010000U
#define SYNCHRONIZE 0x00100000U
#define FILE_SHARE_READ 1U
#define FILE_SHARE_WRITE 2U
#define FILE_SHARE_DELETE 4U
#define CREATE_NEW 1U
#define OPEN_EXISTING 3U
#define FILE_ATTRIBUTE_READONLY 1U
#define FILE_ATTRIBUTE_DIRECTORY 0x10U
#define FILE_ATTRIBUTE_NORMAL 0x80U
#define FILE_ATTRIBUTE_REPARSE_POINT 0x400U
#define FILE_ATTRIBUTE_TEMPORARY 0x100U
#define FILE_FLAG_WRITE_THROUGH 0x80000000U
#define FILE_FLAG_SEQUENTIAL_SCAN 0x08000000U
#define FILE_FLAG_BACKUP_SEMANTICS 0x02000000U
#define FILE_FLAG_OPEN_REPARSE_POINT 0x00200000U
#define FILE_BEGIN 0U
#define FILE_RENAME_FLAG_POSIX_SEMANTICS 2U
#define FILE_NAME_NORMALIZED 0U
#define VOLUME_NAME_DOS 0U
#define DRIVE_FIXED 3U
#define OWNER_SECURITY_INFORMATION 1U
#define DACL_SECURITY_INFORMATION 4U
#define LABEL_SECURITY_INFORMATION 0x10U
#define SE_DACL_PROTECTED 0x1000U
#define SE_SELF_RELATIVE 0x8000U
#define INHERITED_ACE 0x10U
#define OBJECT_INHERIT_ACE 0x01U
#define CONTAINER_INHERIT_ACE 0x02U
#define NO_PROPAGATE_INHERIT_ACE 0x04U
#define INHERIT_ONLY_ACE 0x08U
#define CRITICAL_ACE_FLAG 0x20U
#define ACCESS_ALLOWED_ACE_TYPE 0U
#define ACCESS_DENIED_ACE_TYPE 1U
#define SYSTEM_MANDATORY_LABEL_ACE_TYPE 0x11U
#define SYSTEM_MANDATORY_LABEL_NO_WRITE_UP 1U
#define FILE_ALL_ACCESS 0x001f01ffU
#define FILE_WRITE_DATA 0x00000002U
#define FILE_APPEND_DATA 0x00000004U
#define FILE_WRITE_EA 0x00000010U
#define FILE_DELETE_CHILD 0x00000040U
#define FILE_WRITE_ATTRIBUTES 0x00000100U
#define WRITE_DAC 0x00040000U
#define WRITE_OWNER 0x00080000U
#define SECURITY_BUILTIN_DOMAIN_RID 32U
#define DOMAIN_ALIAS_RID_ADMINS 544U
#define SECURITY_LOCAL_SYSTEM_RID 18U
#define SECURITY_MANDATORY_LOW_RID 4096U
#define SDDL_REVISION_1 1U
#define NETISO_FLAG_FORCE_COMPUTE_BINARIES 1U
#define BCRYPT_USE_SYSTEM_PREFERRED_RNG 2U
#define BCRYPT_SHA256_ALGORITHM L"SHA256"
#define BCRYPT_OBJECT_LENGTH L"ObjectLength"

typedef enum token_information_class {
  TokenUser = 1,
  TokenRestrictedSids = 11,
  TokenIntegrityLevel = 25,
  TokenIsAppContainer = 29
} TOKEN_INFORMATION_CLASS;
typedef enum file_info_by_handle_class {
  FileRenameInfo = 3,
  FileDispositionInfo = 4,
  FileIdInfo = 18,
  FileRenameInfoEx = 22
} FILE_INFO_BY_HANDLE_CLASS;
typedef enum acl_information_class { AclSizeInformation = 2 } ACL_INFORMATION_CLASS;
typedef enum se_object_type { SE_FILE_OBJECT = 1 } SE_OBJECT_TYPE;

typedef struct sid_and_attributes { PSID Sid; DWORD Attributes; } SID_AND_ATTRIBUTES;
typedef struct token_user { SID_AND_ATTRIBUTES User; } TOKEN_USER;
typedef struct token_mandatory_label { SID_AND_ATTRIBUTES Label; } TOKEN_MANDATORY_LABEL;
typedef struct token_groups { DWORD GroupCount; SID_AND_ATTRIBUTES Groups[1]; } TOKEN_GROUPS;
typedef struct file_id_128 { BYTE Identifier[16]; } FILE_ID_128;
typedef struct file_id_info { ULONGLONG VolumeSerialNumber; FILE_ID_128 FileId; } FILE_ID_INFO;
typedef struct by_handle_file_information {
  DWORD dwFileAttributes;
  struct { DWORD dwLowDateTime; DWORD dwHighDateTime; } ftCreationTime, ftLastAccessTime, ftLastWriteTime;
  DWORD dwVolumeSerialNumber;
  DWORD nFileSizeHigh;
  DWORD nFileSizeLow;
  DWORD nNumberOfLinks;
  DWORD nFileIndexHigh;
  DWORD nFileIndexLow;
} BY_HANDLE_FILE_INFORMATION;
typedef struct acl { BYTE AclRevision; BYTE Sbz1; WORD AclSize; WORD AceCount; WORD Sbz2; } ACL;
typedef ACL *PACL;
typedef struct acl_size_information { DWORD AceCount; DWORD AclBytesInUse; DWORD AclBytesFree; } ACL_SIZE_INFORMATION;
typedef struct ace_header { BYTE AceType; BYTE AceFlags; WORD AceSize; } ACE_HEADER;
typedef struct access_allowed_ace { ACE_HEADER Header; ACCESS_MASK Mask; DWORD SidStart; } ACCESS_ALLOWED_ACE;
typedef struct system_mandatory_label_ace { ACE_HEADER Header; ACCESS_MASK Mask; DWORD SidStart; } SYSTEM_MANDATORY_LABEL_ACE;
typedef struct security_attributes { DWORD nLength; LPVOID lpSecurityDescriptor; BOOL bInheritHandle; } SECURITY_ATTRIBUTES;
typedef struct file_rename_info {
  BOOL ReplaceIfExists;
  HANDLE RootDirectory;
  DWORD FileNameLength;
  WCHAR FileName[1];
} FILE_RENAME_INFO;
typedef struct file_disposition_info { BOOL DeleteFile; } FILE_DISPOSITION_INFO;
typedef struct win32_find_data {
  DWORD dwFileAttributes;
  struct { DWORD dwLowDateTime; DWORD dwHighDateTime; } ftCreationTime, ftLastAccessTime, ftLastWriteTime;
  DWORD nFileSizeHigh;
  DWORD nFileSizeLow;
  DWORD dwReserved0;
  DWORD dwReserved1;
  WCHAR cFileName[260];
  WCHAR cAlternateFileName[14];
} WIN32_FIND_DATAW;
typedef struct win32_find_stream_data {
  LARGE_INTEGER StreamSize;
  WCHAR cStreamName[296];
} WIN32_FIND_STREAM_DATA;
typedef struct inet_firewall_ac_capabilities { DWORD count; SID_AND_ATTRIBUTES *capabilities; } INET_FIREWALL_AC_CAPABILITIES;
typedef struct inet_firewall_ac_binaries { DWORD count; LPWSTR *binaries; } INET_FIREWALL_AC_BINARIES;
typedef struct inet_firewall_app_container {
  PSID appContainerSid;
  PSID userSid;
  LPWSTR appContainerName;
  LPWSTR displayName;
  LPWSTR description;
  INET_FIREWALL_AC_CAPABILITIES capabilities;
  INET_FIREWALL_AC_BINARIES binaries;
  LPWSTR workingDirectory;
  LPWSTR packageFullName;
} INET_FIREWALL_APP_CONTAINER;
typedef INET_FIREWALL_APP_CONTAINER *PINET_FIREWALL_APP_CONTAINER;
typedef struct sid_identifier_authority { BYTE Value[6]; } SID_IDENTIFIER_AUTHORITY;
#define SECURITY_NT_AUTHORITY {{0U, 0U, 0U, 0U, 0U, 5U}}
#define SECURITY_MANDATORY_LABEL_AUTHORITY {{0U, 0U, 0U, 0U, 0U, 16U}}

__declspec(dllimport) WCHAR *WINAPI GetCommandLineW(void);
__declspec(dllimport) HANDLE WINAPI GetStdHandle(DWORD);
__declspec(dllimport) BOOL WINAPI ReadFile(HANDLE, LPVOID, DWORD, DWORD *, LPVOID);
__declspec(dllimport) BOOL WINAPI WriteFile(HANDLE, LPCVOID, DWORD, DWORD *, LPVOID);
__declspec(dllimport) DWORD WINAPI SetFilePointer(HANDLE, LONG, LONG *, DWORD);
__declspec(dllimport) __declspec(noreturn) void WINAPI ExitProcess(DWORD);
__declspec(dllimport) DWORD WINAPI GetLastError(void);
__declspec(dllimport) void WINAPI SetLastError(DWORD);
__declspec(dllimport) HANDLE WINAPI GetProcessHeap(void);
__declspec(dllimport) LPVOID WINAPI HeapAlloc(HANDLE, DWORD, SIZE_T);
__declspec(dllimport) BOOL WINAPI HeapFree(HANDLE, DWORD, LPVOID);
__declspec(dllimport) HANDLE WINAPI GetCurrentProcess(void);
__declspec(dllimport) HANDLE WINAPI GetCurrentThread(void);
__declspec(dllimport) BOOL WINAPI CloseHandle(HANDLE);
__declspec(dllimport) HANDLE WINAPI CreateFileW(PCWSTR, DWORD, DWORD, SECURITY_ATTRIBUTES *, DWORD, DWORD, HANDLE);
__declspec(dllimport) BOOL WINAPI CreateDirectoryW(PCWSTR, SECURITY_ATTRIBUTES *);
__declspec(dllimport) DWORD WINAPI GetFileAttributesW(PCWSTR);
__declspec(dllimport) BOOL WINAPI GetFileSizeEx(HANDLE, LARGE_INTEGER *);
__declspec(dllimport) BOOL WINAPI FlushFileBuffers(HANDLE);
__declspec(dllimport) BOOL WINAPI GetFileInformationByHandle(HANDLE, BY_HANDLE_FILE_INFORMATION *);
__declspec(dllimport) BOOL WINAPI GetFileInformationByHandleEx(HANDLE, FILE_INFO_BY_HANDLE_CLASS, LPVOID, DWORD);
__declspec(dllimport) BOOL WINAPI SetFileInformationByHandle(HANDLE, FILE_INFO_BY_HANDLE_CLASS, LPVOID, DWORD);
__declspec(dllimport) DWORD WINAPI GetFinalPathNameByHandleW(HANDLE, LPWSTR, DWORD, DWORD);
__declspec(dllimport) DWORD WINAPI GetDriveTypeW(PCWSTR);
__declspec(dllimport) HANDLE WINAPI FindFirstFileW(PCWSTR, WIN32_FIND_DATAW *);
__declspec(dllimport) BOOL WINAPI FindNextFileW(HANDLE, WIN32_FIND_DATAW *);
__declspec(dllimport) HANDLE WINAPI FindFirstStreamW(PCWSTR, DWORD, WIN32_FIND_STREAM_DATA *, DWORD);
__declspec(dllimport) BOOL WINAPI FindNextStreamW(HANDLE, WIN32_FIND_STREAM_DATA *);
__declspec(dllimport) BOOL WINAPI FindClose(HANDLE);
__declspec(dllimport) BOOL WINAPI DeleteFileW(PCWSTR);
__declspec(dllimport) BOOL WINAPI OpenProcessToken(HANDLE, DWORD, HANDLE *);
__declspec(dllimport) BOOL WINAPI OpenThreadToken(HANDLE, DWORD, BOOL, HANDLE *);
__declspec(dllimport) BOOL WINAPI GetTokenInformation(HANDLE, TOKEN_INFORMATION_CLASS, LPVOID, DWORD, DWORD *);
__declspec(dllimport) BOOL WINAPI IsValidSid(PSID);
__declspec(dllimport) DWORD WINAPI GetLengthSid(PSID);
__declspec(dllimport) BOOL WINAPI CopySid(DWORD, PSID, PSID);
__declspec(dllimport) BOOL WINAPI EqualSid(PSID, PSID);
__declspec(dllimport) BOOL WINAPI AllocateAndInitializeSid(SID_IDENTIFIER_AUTHORITY *, BYTE, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, PSID *);
__declspec(dllimport) PVOID WINAPI FreeSid(PSID);
__declspec(dllimport) BOOL WINAPI GetAclInformation(PACL, LPVOID, DWORD, ACL_INFORMATION_CLASS);
__declspec(dllimport) BOOL WINAPI GetAce(PACL, DWORD, LPVOID *);
__declspec(dllimport) BOOL WINAPI GetSecurityDescriptorControl(PSECURITY_DESCRIPTOR, SECURITY_DESCRIPTOR_CONTROL *, DWORD *);
__declspec(dllimport) DWORD WINAPI GetSecurityDescriptorLength(PSECURITY_DESCRIPTOR);
__declspec(dllimport) BOOL WINAPI MakeSelfRelativeSD(PSECURITY_DESCRIPTOR, PSECURITY_DESCRIPTOR, DWORD *);
__declspec(dllimport) DWORD WINAPI GetSecurityInfo(HANDLE, SE_OBJECT_TYPE, DWORD, PSID *, PSID *, PACL *, PACL *, PSECURITY_DESCRIPTOR *);
__declspec(dllimport) BOOL WINAPI ConvertSidToStringSidW(PSID, LPWSTR *);
__declspec(dllimport) BOOL WINAPI ConvertStringSecurityDescriptorToSecurityDescriptorW(PCWSTR, DWORD, PSECURITY_DESCRIPTOR *, DWORD *);
__declspec(dllimport) HANDLE WINAPI LocalFree(HANDLE);
__declspec(dllimport) NTSTATUS WINAPI BCryptOpenAlgorithmProvider(BCRYPT_ALG_HANDLE *, PCWSTR, PCWSTR, DWORD);
__declspec(dllimport) NTSTATUS WINAPI BCryptGetProperty(BCRYPT_ALG_HANDLE, PCWSTR, PUCHAR, DWORD, DWORD *, DWORD);
__declspec(dllimport) NTSTATUS WINAPI BCryptCreateHash(BCRYPT_ALG_HANDLE, BCRYPT_HASH_HANDLE *, PUCHAR, DWORD, PUCHAR, DWORD, DWORD);
__declspec(dllimport) NTSTATUS WINAPI BCryptHashData(BCRYPT_HASH_HANDLE, PUCHAR, DWORD, DWORD);
__declspec(dllimport) NTSTATUS WINAPI BCryptFinishHash(BCRYPT_HASH_HANDLE, PUCHAR, DWORD, DWORD);
__declspec(dllimport) NTSTATUS WINAPI BCryptDestroyHash(BCRYPT_HASH_HANDLE);
__declspec(dllimport) NTSTATUS WINAPI BCryptCloseAlgorithmProvider(BCRYPT_ALG_HANDLE, DWORD);
__declspec(dllimport) NTSTATUS WINAPI BCryptGenRandom(BCRYPT_ALG_HANDLE, PUCHAR, DWORD, DWORD);
__declspec(dllimport) HRESULT WINAPI CreateAppContainerProfile(PCWSTR, PCWSTR, PCWSTR, SID_AND_ATTRIBUTES *, DWORD, PSID *);
__declspec(dllimport) HRESULT WINAPI DeleteAppContainerProfile(PCWSTR);
__declspec(dllimport) HRESULT WINAPI GetAppContainerFolderPath(PCWSTR, PWSTR *);
__declspec(dllimport) HRESULT WINAPI DeriveAppContainerSidFromAppContainerName(PCWSTR, PSID *);
__declspec(dllimport) void WINAPI CoTaskMemFree(LPVOID);
__declspec(dllimport) DWORD WINAPI NetworkIsolationEnumAppContainers(DWORD, DWORD *, PINET_FIREWALL_APP_CONTAINER *);
__declspec(dllimport) DWORD WINAPI NetworkIsolationFreeAppContainers(PINET_FIREWALL_APP_CONTAINER);

#define FRAME_BYTES 16U
#define MAX_PAYLOAD (1024U * 1024U)
#define REQUEST_KIND 1U
#define RESPONSE_KIND 2U
#define PROTOCOL_VERSION 1U
#define PREPARE_OPERATION 1U
#define LAUNCH_OPERATION 2U
#define TEARDOWN_OPERATION 3U
#define STATUS_OK 0U
#define STATUS_REFUSED 65U
#define STATUS_RECOVERY_REQUIRED 70U
#define STATUS_NOT_IMPLEMENTED 78U
#define EXIT_ARGUMENT_REFUSED 64U
#define EXIT_PROTOCOL_REFUSED 65U
#define EXIT_RECOVERY_REQUIRED 70U
#define EXIT_LIFECYCLE_NOT_IMPLEMENTED 78U
#define PATH_MAX_UNITS 1024U
#define EXECUTION_ROLE_COUNT 3U
#define EXECUTION_MAX_FILE_BYTES (512U * 1024U * 1024U)
#define SID_MAX_BYTES 68U
#define SID_TEXT_MAX_BYTES 184U
#define MONIKER_BYTES 64U
#define TOKEN_BYTES 32U
#define CENSUS_MAXIMUM 4096U
#define JOURNAL_USED 1U
#define JOURNAL_PROFILE_ATTEMPTED 2U
#define JOURNAL_PROFILE_CREATED 3U
#define JOURNAL_PROFILE_DELETE_ATTEMPTED 4U
#define JOURNAL_PROFILE_ABSENCE_PROVED 5U
#define EXECUTION_ATTEMPTED 1U
#define EXECUTION_CREATED 2U
#define EXECUTION_DELETE_ATTEMPTED 3U
#define EXECUTION_ABSENCE_PROVED 4U

static const WCHAR serve_mode[] = L"SERVE";
static const WCHAR recover_mode[] = L"RECOVER";
static const void *volatile image_relocation_anchor = serve_mode;
static BYTE frame_payload[MAX_PAYLOAD];

typedef struct broker_frame {
  BYTE operation;
  DWORD length;
  BYTE *payload;
} BROKER_FRAME;

typedef struct profile_identity {
  BYTE token[TOKEN_BYTES];
  WCHAR moniker[MONIKER_BYTES + 1U];
  BYTE sid[SID_MAX_BYTES];
  WORD sid_length;
  CHAR sid_text[SID_TEXT_MAX_BYTES + 1U];
  WORD sid_text_length;
  WCHAR folder[PATH_MAX_UNITS + 1U];
  WORD folder_units;
  BYTE folder_binding[32];
  BYTE prior_digest[32];
  BYTE phase;
} PROFILE_IDENTITY;

typedef struct execution_prepare_paths {
  WCHAR state_root[PATH_MAX_UNITS + 1U];
  WORD state_root_units;
  WCHAR execution_parent[PATH_MAX_UNITS + 1U];
  WORD execution_parent_units;
  WCHAR sources[EXECUTION_ROLE_COUNT][PATH_MAX_UNITS + 1U];
  WORD source_units[EXECUTION_ROLE_COUNT];
} EXECUTION_PREPARE_PATHS;

typedef struct retained_object {
  HANDLE handle;
  WCHAR path[PATH_MAX_UNITS + 1U];
  WORD path_units;
  FILE_ID_INFO id;
  DWORD attributes;
  DWORD links;
  ULONGLONG size;
  PSECURITY_DESCRIPTOR security;
  DWORD security_length;
  BYTE binding[32];
} RETAINED_OBJECT;

typedef struct execution_custody {
  RETAINED_OBJECT parent;
  RETAINED_OBJECT sources[EXECUTION_ROLE_COUNT];
  RETAINED_OBJECT root;
  RETAINED_OBJECT targets[EXECUTION_ROLE_COUNT];
  BYTE source_bindings[EXECUTION_ROLE_COUNT][32];
  BYTE target_bindings[EXECUTION_ROLE_COUNT][32];
  BYTE root_binding[32];
  BYTE prior_digest[32];
  BYTE profile_created_digest[32];
  BYTE phase;
} EXECUTION_CUSTODY;

typedef struct root_custody {
  HANDLE handle;
  HANDLE token;
  WCHAR path[PATH_MAX_UNITS + 1U];
  WORD path_units;
  FILE_ID_INFO id;
  DWORD attributes;
  DWORD links;
  PSID stable_sid;
  DWORD stable_sid_length;
  PSID integrity_sid;
  DWORD integrity_sid_length;
  PSECURITY_DESCRIPTOR security;
  DWORD security_length;
  BYTE digest[32];
  int resource_ambiguous;
} ROOT_CUSTODY;

typedef struct journal_group {
  PROFILE_IDENTITY identity;
  BYTE final_seen[6];
  BYTE pending_seen[6];
  EXECUTION_CUSTODY *execution;
  BYTE execution_final_seen[5];
  BYTE execution_pending_seen[5];
  BYTE profile_created_digest[32];
} JOURNAL_GROUP;

#if defined(OP_WINDOWS_LIFECYCLE_FIXTURE)
static int fixture_retain_root(const WCHAR *, WORD, ROOT_CUSTODY *);
static int fixture_preflight_and_recover(ROOT_CUSTODY *);
static int fixture_create_profile(ROOT_CUSTODY *, PROFILE_IDENTITY *, HANDLE *);
static int fixture_cleanup_profile(ROOT_CUSTODY *, PROFILE_IDENTITY *, HANDLE *);
static int fixture_release_root(ROOT_CUSTODY *);
static int fixture_retain_execution(ROOT_CUSTODY *, const EXECUTION_PREPARE_PATHS *,
                                    const PROFILE_IDENTITY *, EXECUTION_CUSTODY *);
static int fixture_construct_execution(ROOT_CUSTODY *, PROFILE_IDENTITY *,
                                       EXECUTION_CUSTODY *);
static int fixture_cleanup_execution(ROOT_CUSTODY *, PROFILE_IDENTITY *,
                                     EXECUTION_CUSTODY *);
static int fixture_release_execution(ROOT_CUSTODY *, EXECUTION_CUSTODY *);
#define OP_BROKER_RETAIN_ROOT fixture_retain_root
#define OP_BROKER_PREFLIGHT fixture_preflight_and_recover
#define OP_BROKER_CREATE_PROFILE fixture_create_profile
#define OP_BROKER_CLEANUP_PROFILE fixture_cleanup_profile
#define OP_BROKER_RELEASE_ROOT fixture_release_root
#define OP_BROKER_RETAIN_EXECUTION fixture_retain_execution
#define OP_BROKER_CONSTRUCT_EXECUTION fixture_construct_execution
#define OP_BROKER_CLEANUP_EXECUTION fixture_cleanup_execution
#define OP_BROKER_RELEASE_EXECUTION fixture_release_execution
#else
#define OP_BROKER_RETAIN_ROOT retain_root
#define OP_BROKER_PREFLIGHT preflight_and_recover
#define OP_BROKER_CREATE_PROFILE create_profile
#define OP_BROKER_CLEANUP_PROFILE cleanup_profile
#define OP_BROKER_RELEASE_ROOT release_root
#define OP_BROKER_RETAIN_EXECUTION retain_execution_inputs
#define OP_BROKER_CONSTRUCT_EXECUTION construct_execution
#define OP_BROKER_CLEANUP_EXECUTION cleanup_execution
#define OP_BROKER_RELEASE_EXECUTION release_execution
#endif

#if defined(OP_WINDOWS_FAULT_FIXTURE)
static HANDLE WINAPI fixture_CreateFileW(PCWSTR, DWORD, DWORD, SECURITY_ATTRIBUTES *, DWORD,
                                         DWORD, HANDLE);
static BOOL WINAPI fixture_WriteFile(HANDLE, LPCVOID, DWORD, DWORD *, LPVOID);
static BOOL WINAPI fixture_ReadFile(HANDLE, LPVOID, DWORD, DWORD *, LPVOID);
static BOOL WINAPI fixture_FlushFileBuffers(HANDLE);
static BOOL WINAPI fixture_GetFileInformationByHandle(HANDLE, BY_HANDLE_FILE_INFORMATION *);
static BOOL WINAPI fixture_GetFileInformationByHandleEx(HANDLE, FILE_INFO_BY_HANDLE_CLASS,
                                                        LPVOID, DWORD);
static BOOL WINAPI fixture_SetFileInformationByHandle(HANDLE, FILE_INFO_BY_HANDLE_CLASS,
                                                      LPVOID, DWORD);
static DWORD WINAPI fixture_GetFileAttributesW(PCWSTR);
static BOOL WINAPI fixture_CloseHandle(HANDLE);
static BOOL WINAPI fixture_FindClose(HANDLE);
static BOOL WINAPI fixture_HeapFree(HANDLE, DWORD, LPVOID);
static HANDLE WINAPI fixture_LocalFree(HANDLE);
static PVOID WINAPI fixture_FreeSid(PSID);
static NTSTATUS WINAPI fixture_BCryptDestroyHash(BCRYPT_HASH_HANDLE);
static NTSTATUS WINAPI fixture_BCryptCloseAlgorithmProvider(BCRYPT_ALG_HANDLE, DWORD);
#define CreateFileW fixture_CreateFileW
#define WriteFile fixture_WriteFile
#define ReadFile fixture_ReadFile
#define FlushFileBuffers fixture_FlushFileBuffers
#define GetFileInformationByHandle fixture_GetFileInformationByHandle
#define GetFileInformationByHandleEx fixture_GetFileInformationByHandleEx
#define SetFileInformationByHandle fixture_SetFileInformationByHandle
#define GetFileAttributesW fixture_GetFileAttributesW
#define CloseHandle fixture_CloseHandle
#define FindClose fixture_FindClose
#define HeapFree fixture_HeapFree
#define LocalFree fixture_LocalFree
#define FreeSid fixture_FreeSid
#define BCryptDestroyHash fixture_BCryptDestroyHash
#define BCryptCloseAlgorithmProvider fixture_BCryptCloseAlgorithmProvider
#endif

#if defined(OP_WINDOWS_EXECUTION_FIXTURE)
static BOOL WINAPI fixture_execution_CreateDirectoryW(
    PCWSTR, SECURITY_ATTRIBUTES *);
static HANDLE WINAPI fixture_execution_CreateFileW(
    PCWSTR, DWORD, DWORD, SECURITY_ATTRIBUTES *, DWORD, DWORD, HANDLE);
static BOOL WINAPI fixture_execution_WriteFile(HANDLE, LPCVOID, DWORD,
                                                DWORD *, LPVOID);
static BOOL WINAPI fixture_execution_ReadFile(HANDLE, LPVOID, DWORD, DWORD *,
                                               LPVOID);
static BOOL WINAPI fixture_execution_FlushFileBuffers(HANDLE);
static BOOL WINAPI fixture_execution_GetFileInformationByHandle(
    HANDLE, BY_HANDLE_FILE_INFORMATION *);
static BOOL WINAPI fixture_execution_GetFileInformationByHandleEx(
    HANDLE, FILE_INFO_BY_HANDLE_CLASS, LPVOID, DWORD);
static BOOL WINAPI fixture_execution_SetFileInformationByHandle(
    HANDLE, FILE_INFO_BY_HANDLE_CLASS, LPVOID, DWORD);
static DWORD WINAPI fixture_execution_GetFileAttributesW(PCWSTR);
static BOOL WINAPI fixture_execution_CloseHandle(HANDLE);
static BOOL WINAPI fixture_execution_FindClose(HANDLE);
#define CreateDirectoryW fixture_execution_CreateDirectoryW
#define CreateFileW fixture_execution_CreateFileW
#define WriteFile fixture_execution_WriteFile
#define ReadFile fixture_execution_ReadFile
#define FlushFileBuffers fixture_execution_FlushFileBuffers
#define GetFileInformationByHandle fixture_execution_GetFileInformationByHandle
#define GetFileInformationByHandleEx fixture_execution_GetFileInformationByHandleEx
#define SetFileInformationByHandle fixture_execution_SetFileInformationByHandle
#define GetFileAttributesW fixture_execution_GetFileAttributesW
#define CloseHandle fixture_execution_CloseHandle
#define FindClose fixture_execution_FindClose
#endif

#if defined(OP_WINDOWS_PROFILE_FIXTURE)
static HRESULT WINAPI fixture_CreateAppContainerProfile(PCWSTR, PCWSTR, PCWSTR,
                                                        SID_AND_ATTRIBUTES *, DWORD, PSID *);
static HRESULT WINAPI fixture_DeleteAppContainerProfile(PCWSTR);
static HRESULT WINAPI fixture_GetAppContainerFolderPath(PCWSTR, PWSTR *);
static HANDLE WINAPI fixture_profile_CreateFileW(PCWSTR, DWORD, DWORD, SECURITY_ATTRIBUTES *,
                                                 DWORD, DWORD, HANDLE);
static BOOL WINAPI fixture_profile_CloseHandle(HANDLE);
static BOOL WINAPI fixture_profile_GetFileInformationByHandle(HANDLE,
                                                               BY_HANDLE_FILE_INFORMATION *);
static BOOL WINAPI fixture_profile_GetFileInformationByHandleEx(HANDLE,
                                                                 FILE_INFO_BY_HANDLE_CLASS,
                                                                 LPVOID, DWORD);
static DWORD WINAPI fixture_profile_GetSecurityInfo(HANDLE, SE_OBJECT_TYPE, DWORD, PSID *,
                                                     PSID *, PACL *, PACL *,
                                                     PSECURITY_DESCRIPTOR *);
static BOOL WINAPI fixture_profile_WriteFile(HANDLE, LPCVOID, DWORD, DWORD *, LPVOID);
static PVOID WINAPI fixture_profile_FreeSid(PSID);
#define CreateAppContainerProfile fixture_CreateAppContainerProfile
#define DeleteAppContainerProfile fixture_DeleteAppContainerProfile
#define GetAppContainerFolderPath fixture_GetAppContainerFolderPath
#define CreateFileW fixture_profile_CreateFileW
#define CloseHandle fixture_profile_CloseHandle
#define GetFileInformationByHandle fixture_profile_GetFileInformationByHandle
#define GetFileInformationByHandleEx fixture_profile_GetFileInformationByHandleEx
#define GetSecurityInfo fixture_profile_GetSecurityInfo
#define WriteFile fixture_profile_WriteFile
#define FreeSid fixture_profile_FreeSid
#endif

static int equal_bytes(const void *left_value, const void *right_value, SIZE_T length) {
  const BYTE *left = (const BYTE *)left_value;
  const BYTE *right = (const BYTE *)right_value;
  BYTE difference = 0;
  SIZE_T index;
  for (index = 0; index < length; index += 1U) difference |= left[index] ^ right[index];
  return difference == 0;
}

static void zero_bytes(void *value, SIZE_T length) {
  BYTE *bytes = (BYTE *)value;
  SIZE_T index;
  for (index = 0; index < length; index += 1U) bytes[index] = 0;
}

static void copy_bytes(void *destination, const void *source_value, SIZE_T length) {
  BYTE *target = (BYTE *)destination;
  const BYTE *source = (const BYTE *)source_value;
  SIZE_T index;
  for (index = 0; index < length; index += 1U) target[index] = source[index];
}

static SIZE_T wide_length(const WCHAR *value) {
  SIZE_T length = 0;
  while (value[length] != L'\0') length += 1U;
  return length;
}

static int bounded_wide_length(const WCHAR *value, SIZE_T bound, SIZE_T *length) {
  SIZE_T index;
  if (value == NULL) return 0;
  for (index = 0; index <= bound; index += 1U) {
    if (value[index] == L'\0') {
      if (index == 0U) return 0;
      *length = index;
      return 1;
    }
  }
  return 0;
}

static SIZE_T ascii_length(const CHAR *value) {
  SIZE_T length = 0;
  while (value[length] != '\0') length += 1U;
  return length;
}

static int wide_equal(const WCHAR *left, const WCHAR *right) {
  SIZE_T index = 0;
  while (left[index] != L'\0' && right[index] != L'\0') {
    if (left[index] != right[index]) return 0;
    index += 1U;
  }
  return left[index] == right[index];
}

static WORD read_u16(const BYTE *bytes) {
  return (WORD)(((WORD)bytes[0]) | ((WORD)bytes[1] << 8U));
}

static DWORD read_u32(const BYTE *bytes) {
  return ((DWORD)bytes[0]) | ((DWORD)bytes[1] << 8U) | ((DWORD)bytes[2] << 16U) |
         ((DWORD)bytes[3] << 24U);
}

static void write_u16(BYTE *bytes, WORD value) {
  bytes[0] = (BYTE)value;
  bytes[1] = (BYTE)(value >> 8U);
}

static void write_u32(BYTE *bytes, DWORD value) {
  bytes[0] = (BYTE)value;
  bytes[1] = (BYTE)(value >> 8U);
  bytes[2] = (BYTE)(value >> 16U);
  bytes[3] = (BYTE)(value >> 24U);
}

static void write_u64(BYTE *bytes, ULONGLONG value) {
  DWORD index;
  for (index = 0; index < 8U; index += 1U) bytes[index] = (BYTE)(value >> (index * 8U));
}

static int write_all(HANDLE output, const BYTE *bytes, DWORD length) {
  DWORD offset = 0;
  while (offset < length) {
    DWORD written = 0;
    if (!WriteFile(output, bytes + offset, length - offset, &written, NULL) || written == 0U)
      return 0;
    offset += written;
  }
  return 1;
}

static void diagnostic(const CHAR *text) {
  HANDLE output = GetStdHandle(STD_ERROR_HANDLE);
  if (output != NULL && output != INVALID_HANDLE_VALUE)
    (void)write_all(output, (const BYTE *)text, (DWORD)ascii_length(text));
}

static int read_exact(HANDLE input, BYTE *bytes, DWORD length) {
  DWORD offset = 0;
  while (offset < length) {
    DWORD received = 0;
    if (!ReadFile(input, bytes + offset, length - offset, &received, NULL) || received == 0U)
      return 0;
    offset += received;
  }
  return 1;
}

static int read_one(HANDLE input, BYTE *value) {
  DWORD received = 0;
  if (!ReadFile(input, value, 1U, &received, NULL)) return GetLastError() == ERROR_BROKEN_PIPE ? 0 : -1;
  return received == 0U ? 0 : 1;
}

static __declspec(noreturn) void protocol_refused(void) {
  diagnostic("windows-broker:protocol\n");
  ExitProcess(EXIT_PROTOCOL_REFUSED);
}

static int read_frame(HANDLE input, BROKER_FRAME *frame, int first) {
  BYTE header[FRAME_BYTES];
  BYTE first_byte;
  if (!first) {
    int result = read_one(input, &first_byte);
    if (result <= 0) return result;
    header[0] = first_byte;
    if (!read_exact(input, header + 1U, FRAME_BYTES - 1U)) return -1;
  } else if (!read_exact(input, header, FRAME_BYTES)) {
    return -1;
  }
  if (header[0] != 'O' || header[1] != 'P' || header[2] != 'W' || header[3] != 'B' ||
      header[4] != PROTOCOL_VERSION || header[5] != REQUEST_KIND || header[7] != 0U ||
      read_u32(header + 12U) != 0U ||
      (header[6] != PREPARE_OPERATION && header[6] != LAUNCH_OPERATION &&
       header[6] != TEARDOWN_OPERATION))
    return -1;
  frame->operation = header[6];
  frame->length = read_u32(header + 8U);
  frame->payload = frame_payload;
  if (frame->length > MAX_PAYLOAD) return -1;
  if (frame->length != 0U && !read_exact(input, frame_payload, frame->length)) return -1;
  return 1;
}

static int send_response(HANDLE output, BYTE operation, BYTE status, const BYTE *payload, DWORD length) {
  BYTE header[FRAME_BYTES];
  zero_bytes(header, sizeof(header));
  header[0] = 'O'; header[1] = 'P'; header[2] = 'W'; header[3] = 'B';
  header[4] = PROTOCOL_VERSION; header[5] = RESPONSE_KIND; header[6] = operation; header[7] = status;
  write_u32(header + 8U, length);
  if (!write_all(output, header, sizeof(header))) return 0;
  if (length != 0U && !write_all(output, payload, length)) return 0;
  return 1;
}

static int sha256(const BYTE *bytes, DWORD length, BYTE digest[32], int *resource_ambiguous) {
  BCRYPT_ALG_HANDLE algorithm = NULL;
  BCRYPT_HASH_HANDLE hash = NULL;
  BYTE *object = NULL;
  DWORD object_length = 0;
  DWORD returned = 0;
  int cleanup_ok = 1;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, NULL, 0U) < 0 ||
      BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, (PUCHAR)&object_length,
                        sizeof(object_length), &returned, 0U) < 0 ||
      returned != sizeof(object_length) || object_length == 0U)
    goto failed;
  object = (BYTE *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, object_length);
  if (object == NULL || BCryptCreateHash(algorithm, &hash, object, object_length, NULL, 0U, 0U) < 0 ||
      BCryptHashData(hash, (PUCHAR)bytes, length, 0U) < 0 ||
      BCryptFinishHash(hash, digest, 32U, 0U) < 0)
    goto failed;
  if (BCryptDestroyHash(hash) < 0) cleanup_ok = 0;
  if (BCryptCloseAlgorithmProvider(algorithm, 0U) < 0) cleanup_ok = 0;
  if (!HeapFree(GetProcessHeap(), 0U, object)) cleanup_ok = 0;
  if (!cleanup_ok) *resource_ambiguous = 1;
  return 1;
failed:
  if (hash != NULL && BCryptDestroyHash(hash) < 0) *resource_ambiguous = 1;
  if (algorithm != NULL && BCryptCloseAlgorithmProvider(algorithm, 0U) < 0)
    *resource_ambiguous = 1;
  if (object != NULL && !HeapFree(GetProcessHeap(), 0U, object)) *resource_ambiguous = 1;
  return 0;
}

static int canonical_scope_path(const BYTE *payload, DWORD length, WCHAR path[PATH_MAX_UNITS + 1U], WORD *units) {
  WORD count;
  DWORD index;
  DWORD segment_start;
  if (length < 14U || payload[0] != 'O' || payload[1] != 'P' || payload[2] != 'W' ||
      payload[3] != 'P' || payload[4] != 1U || payload[5] != 1U || payload[6] != 0U ||
      payload[7] != 0U || payload[10] != 0U || payload[11] != 0U)
    return 0;
  count = read_u16(payload + 8U);
  if (count == 0U || count > PATH_MAX_UNITS || length != 12U + (DWORD)count * 2U) return 0;
  for (index = 0; index < count; index += 1U) {
    WORD unit = read_u16(payload + 12U + index * 2U);
    if (unit == 0U || (unit >= 0xd800U && unit <= 0xdfffU) || unit == L'/' ||
        (unit == L':' && index != 5U) || unit == L'*' || (unit == L'?' && index != 2U) ||
        unit == L'"' || unit == L'<' || unit == L'>' || unit == L'|')
      return 0;
    path[index] = (WCHAR)unit;
  }
  path[count] = L'\0';
  if (count < 8U || path[0] != L'\\' || path[1] != L'\\' || path[2] != L'?' ||
      path[3] != L'\\' || path[4] < L'A' || path[4] > L'Z' || path[5] != L':' ||
      path[6] != L'\\' || path[7] == L'\\' || path[count - 1U] == L'\\')
    return 0;
  segment_start = 7U;
  for (index = 7U; index <= count; index += 1U) {
    if (index == count || path[index] == L'\\') {
      DWORD segment_length = index - segment_start;
      if (segment_length == 0U || (segment_length == 1U && path[segment_start] == L'.') ||
          (segment_length == 2U && path[segment_start] == L'.' && path[segment_start + 1U] == L'.'))
        return 0;
      segment_start = index + 1U;
    }
  }
  *units = count;
  return 1;
}

static int canonical_folder_path(const WCHAR *path, WORD count) {
  DWORD index;
  DWORD segment_start;
  if (count < 8U || count > PATH_MAX_UNITS || path[0] != L'\\' || path[1] != L'\\' ||
      path[2] != L'?' || path[3] != L'\\' || path[4] < L'A' || path[4] > L'Z' ||
      path[5] != L':' || path[6] != L'\\' || path[7] == L'\\' || path[count - 1U] == L'\\')
    return 0;
  segment_start = 7U;
  for (index = 0; index < count; index += 1U) {
    WCHAR unit = path[index];
    if (unit == L'\0' || (unit >= 0xd800U && unit <= 0xdfffU) || unit == L'/' ||
        (unit == L':' && index != 5U) || unit == L'*' || (unit == L'?' && index != 2U) ||
        unit == L'"' || unit == L'<' || unit == L'>' || unit == L'|')
      return 0;
  }
  for (index = 7U; index <= count; index += 1U) {
    if (index == count || path[index] == L'\\') {
      DWORD segment_length = index - segment_start;
      if (segment_length == 0U || (segment_length == 1U && path[segment_start] == L'.') ||
          (segment_length == 2U && path[segment_start] == L'.' && path[segment_start + 1U] == L'.'))
        return 0;
      segment_start = index + 1U;
    }
  }
  return 1;
}

static int canonical_execution_prepare(const BYTE *payload, DWORD length,
                                       EXECUTION_PREPARE_PATHS *paths) {
  WORD counts[5];
  WCHAR *outputs[5] = {
    paths->state_root, paths->execution_parent, paths->sources[0],
    paths->sources[1], paths->sources[2]
  };
  WORD *output_counts[5] = {
    &paths->state_root_units, &paths->execution_parent_units,
    &paths->source_units[0], &paths->source_units[1], &paths->source_units[2]
  };
  DWORD cursor = 20U;
  DWORD total_units = 0U;
  DWORD field;
  if (length < 30U || payload[0] != 'O' || payload[1] != 'P' || payload[2] != 'W' ||
      payload[3] != 'E' || payload[4] != 1U || payload[5] != 1U ||
      payload[6] != 0U || payload[7] != 0U || payload[18] != 0U || payload[19] != 0U)
    return 0;
  zero_bytes(paths, sizeof(*paths));
  for (field = 0U; field < 5U; field += 1U) {
    counts[field] = read_u16(payload + 8U + field * 2U);
    if (counts[field] == 0U || counts[field] > PATH_MAX_UNITS) return 0;
    total_units += counts[field];
  }
  if (length != 20U + total_units * 2U) return 0;
  for (field = 0U; field < 5U; field += 1U) {
    DWORD bytes = (DWORD)counts[field] * 2U;
    copy_bytes(outputs[field], payload + cursor, bytes);
    outputs[field][counts[field]] = L'\0';
    if (!canonical_folder_path(outputs[field], counts[field])) return 0;
    *output_counts[field] = counts[field];
    cursor += bytes;
  }
  return cursor == length;
}

static int canonical_frame_payload(const BROKER_FRAME *frame) {
  if (frame->operation == PREPARE_OPERATION) {
    EXECUTION_PREPARE_PATHS *ignored = (EXECUTION_PREPARE_PATHS *)HeapAlloc(
      GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(EXECUTION_PREPARE_PATHS));
    int valid;
    if (ignored == NULL) return 0;
    valid = canonical_execution_prepare(frame->payload, frame->length, ignored);
    if (!HeapFree(GetProcessHeap(), 0U, ignored)) return 0;
    return valid;
  }
  return frame->length == 0U;
}

static int copy_token_sid(ROOT_CUSTODY *root, HANDLE token, TOKEN_INFORMATION_CLASS kind,
                          PSID *sid, DWORD *sid_length) {
  DWORD required = 0;
  BYTE *buffer;
  PSID source;
  GetTokenInformation(token, kind, NULL, 0U, &required);
  if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || required == 0U) return 0;
  buffer = (BYTE *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, required);
  if (buffer == NULL || !GetTokenInformation(token, kind, buffer, required, &required)) {
    if (buffer != NULL && !HeapFree(GetProcessHeap(), 0U, buffer)) root->resource_ambiguous = 1;
    return 0;
  }
  source = kind == TokenUser ? ((TOKEN_USER *)buffer)->User.Sid : ((TOKEN_MANDATORY_LABEL *)buffer)->Label.Sid;
  if (!IsValidSid(source)) {
    if (!HeapFree(GetProcessHeap(), 0U, buffer)) root->resource_ambiguous = 1;
    return 0;
  }
  *sid_length = GetLengthSid(source);
  if (*sid_length < 8U || *sid_length > SID_MAX_BYTES) {
    if (!HeapFree(GetProcessHeap(), 0U, buffer)) root->resource_ambiguous = 1;
    return 0;
  }
  *sid = (PSID)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, *sid_length);
  if (*sid == NULL || !CopySid(*sid_length, *sid, source)) {
    if (*sid != NULL && !HeapFree(GetProcessHeap(), 0U, *sid)) root->resource_ambiguous = 1;
    *sid = NULL;
    if (!HeapFree(GetProcessHeap(), 0U, buffer)) root->resource_ambiguous = 1;
    return 0;
  }
  if (!HeapFree(GetProcessHeap(), 0U, buffer)) root->resource_ambiguous = 1;
  return !root->resource_ambiguous;
}

static int exact_acl(ROOT_CUSTODY *root, PACL acl, PSID stable_sid,
                     PSID integrity_sid, int mandatory) {
  ACL_SIZE_INFORMATION information;
  DWORD index;
  if (acl == NULL || !GetAclInformation(acl, &information, sizeof(information), AclSizeInformation) ||
      information.AceCount != (mandatory ? 1U : 2U))
    return 0;
  for (index = 0; index < information.AceCount; index += 1U) {
    void *raw = NULL;
    ACE_HEADER *header;
    PSID sid;
    if (!GetAce(acl, index, &raw)) return 0;
    header = (ACE_HEADER *)raw;
    if ((header->AceFlags & INHERITED_ACE) != 0U || header->AceSize < 16U) return 0;
    if (mandatory) {
      SYSTEM_MANDATORY_LABEL_ACE *ace = (SYSTEM_MANDATORY_LABEL_ACE *)raw;
      if (header->AceType != SYSTEM_MANDATORY_LABEL_ACE_TYPE) return 0;
      sid = (PSID)&ace->SidStart;
      if (!IsValidSid(sid) || GetLengthSid(sid) > header->AceSize - 8U ||
          ace->Mask != SYSTEM_MANDATORY_LABEL_NO_WRITE_UP || !EqualSid(sid, integrity_sid))
        return 0;
    } else {
      ACCESS_ALLOWED_ACE *ace = (ACCESS_ALLOWED_ACE *)raw;
      SID_IDENTIFIER_AUTHORITY authority = SECURITY_NT_AUTHORITY;
      PSID system_sid = NULL;
      int valid;
      if (header->AceType != ACCESS_ALLOWED_ACE_TYPE ||
          !AllocateAndInitializeSid(&authority, 1U, SECURITY_LOCAL_SYSTEM_RID, 0U, 0U, 0U, 0U, 0U,
                                    0U, 0U, &system_sid))
        return 0;
      sid = (PSID)&ace->SidStart;
      valid = IsValidSid(sid) && GetLengthSid(sid) <= header->AceSize - 8U &&
              ace->Mask == FILE_ALL_ACCESS &&
              ((index == 0U && EqualSid(sid, stable_sid)) ||
               (index == 1U && EqualSid(sid, system_sid)));
      if (FreeSid(system_sid) != NULL) {
        root->resource_ambiguous = 1;
        valid = 0;
      }
      if (!valid) return 0;
    }
  }
  return 1;
}

static int forbidden_profile_sid(PSID sid, ROOT_CUSTODY *root) {
  SID_IDENTIFIER_AUTHORITY authority = SECURITY_NT_AUTHORITY;
  PSID system_sid = NULL;
  int forbidden;
  if (!AllocateAndInitializeSid(&authority, 1U, SECURITY_LOCAL_SYSTEM_RID, 0U, 0U, 0U, 0U, 0U,
                                0U, 0U, &system_sid))
    return 1;
  forbidden = EqualSid(sid, root->stable_sid) || EqualSid(sid, system_sid);
  if (FreeSid(system_sid) != NULL) {
    root->resource_ambiguous = 1;
    return 1;
  }
  return forbidden;
}

static int capture_security(ROOT_CUSTODY *root, HANDLE handle, PSECURITY_DESCRIPTOR *descriptor,
                            DWORD *length) {
  PSID owner = NULL;
  PACL dacl = NULL;
  PACL sacl = NULL;
  PSECURITY_DESCRIPTOR security = NULL;
  SECURITY_DESCRIPTOR_CONTROL control;
  DWORD revision;
  DWORD relative_length = 0;
  PSECURITY_DESCRIPTOR relative = NULL;
  DWORD result = GetSecurityInfo(
    handle,
    SE_FILE_OBJECT,
    OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION | LABEL_SECURITY_INFORMATION,
    &owner,
    NULL,
    &dacl,
    &sacl,
    &security
  );
  if (result != ERROR_SUCCESS || security == NULL || owner == NULL || !EqualSid(owner, root->stable_sid) ||
      !GetSecurityDescriptorControl(security, &control, &revision) ||
      (control & SE_DACL_PROTECTED) == 0U ||
      !exact_acl(root, dacl, root->stable_sid, root->integrity_sid, 0) ||
      !exact_acl(root, sacl, root->stable_sid, root->integrity_sid, 1)) {
    if (security != NULL && LocalFree(security) != NULL) root->resource_ambiguous = 1;
    return 0;
  }
  if ((control & SE_SELF_RELATIVE) != 0U) {
    relative_length = GetSecurityDescriptorLength(security);
    relative = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, relative_length);
    if (relative != NULL) copy_bytes(relative, security, relative_length);
  } else {
    (void)MakeSelfRelativeSD(security, NULL, &relative_length);
    if (relative_length != 0U)
      relative = HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, relative_length);
    if (relative != NULL && !MakeSelfRelativeSD(security, relative, &relative_length)) {
      if (!HeapFree(GetProcessHeap(), 0U, relative)) root->resource_ambiguous = 1;
      relative = NULL;
    }
  }
  if (LocalFree(security) != NULL) root->resource_ambiguous = 1;
  if (relative == NULL || relative_length == 0U) return 0;
  *length = relative_length;
  *descriptor = relative;
  return 1;
}

static int probe_root_path(ROOT_CUSTODY *root) {
  HANDLE probe = CreateFileW(root->path, FILE_READ_ATTRIBUTES | READ_CONTROL,
                             FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL,
                             OPEN_EXISTING,
                             FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  FILE_ID_INFO id;
  BY_HANDLE_FILE_INFORMATION basic;
  WCHAR final_path[PATH_MAX_UNITS + 1U];
  DWORD final_units;
  PSECURITY_DESCRIPTOR security = NULL;
  DWORD security_length = 0;
  int valid;
  if (probe == INVALID_HANDLE_VALUE) return 0;
  final_units = GetFinalPathNameByHandleW(probe, final_path, PATH_MAX_UNITS + 1U,
                                         FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  valid = GetFileInformationByHandleEx(probe, FileIdInfo, &id, sizeof(id)) &&
          GetFileInformationByHandle(probe, &basic) &&
          final_units == root->path_units && final_units <= PATH_MAX_UNITS &&
          wide_equal(final_path, root->path) &&
          (basic.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0U &&
          (basic.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0U &&
          basic.nNumberOfLinks == root->links && equal_bytes(&id, &root->id, sizeof(id)) &&
          basic.dwFileAttributes == root->attributes &&
          capture_security(root, probe, &security, &security_length) &&
          security_length == root->security_length &&
          equal_bytes(security, root->security, security_length);
  if (security != NULL && !HeapFree(GetProcessHeap(), 0U, security)) root->resource_ambiguous = 1;
  if (!CloseHandle(probe)) root->resource_ambiguous = 1;
  return valid;
}

static int root_snapshot(ROOT_CUSTODY *root, int initial) {
  FILE_ID_INFO id;
  BY_HANDLE_FILE_INFORMATION basic;
  WCHAR final_path[PATH_MAX_UNITS + 1U];
  DWORD final_units;
  PSECURITY_DESCRIPTOR security = NULL;
  DWORD security_length = 0;
  if (!GetFileInformationByHandleEx(root->handle, FileIdInfo, &id, sizeof(id)) ||
      !GetFileInformationByHandle(root->handle, &basic) ||
      (basic.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0U ||
      (basic.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0U || basic.nNumberOfLinks != 1U)
    return 0;
  final_units = GetFinalPathNameByHandleW(root->handle, final_path, PATH_MAX_UNITS + 1U,
                                         FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  if (final_units != root->path_units || final_units > PATH_MAX_UNITS || !wide_equal(final_path, root->path) ||
      !capture_security(root, root->handle, &security, &security_length))
    return 0;
  if (initial) {
    DWORD domain_bytes = (DWORD)ascii_length("op.windows-profile-state-root/v1") + 1U;
    DWORD path_bytes = (DWORD)root->path_units * 2U;
    DWORD material_length = domain_bytes + 4U + path_bytes + 8U + 16U + 4U + 4U + 4U + security_length;
    BYTE *material = (BYTE *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, material_length);
    DWORD cursor = 0;
    if (material == NULL) {
      if (!HeapFree(GetProcessHeap(), 0U, security)) root->resource_ambiguous = 1;
      return 0;
    }
    copy_bytes(material + cursor, "op.windows-profile-state-root/v1", domain_bytes); cursor += domain_bytes;
    write_u32(material + cursor, path_bytes); cursor += 4U;
    copy_bytes(material + cursor, root->path, path_bytes); cursor += path_bytes;
    write_u64(material + cursor, id.VolumeSerialNumber); cursor += 8U;
    copy_bytes(material + cursor, id.FileId.Identifier, 16U); cursor += 16U;
    write_u32(material + cursor, basic.dwFileAttributes); cursor += 4U;
    write_u32(material + cursor, basic.nNumberOfLinks); cursor += 4U;
    write_u32(material + cursor, security_length); cursor += 4U;
    copy_bytes(material + cursor, security, security_length);
    root->id = id;
    root->attributes = basic.dwFileAttributes;
    root->links = basic.nNumberOfLinks;
    root->security = security;
    root->security_length = security_length;
    if (!sha256(material, material_length, root->digest, &root->resource_ambiguous)) {
      if (!HeapFree(GetProcessHeap(), 0U, material)) root->resource_ambiguous = 1;
      return 0;
    }
    if (!HeapFree(GetProcessHeap(), 0U, material)) root->resource_ambiguous = 1;
    return probe_root_path(root);
  }
  if (!equal_bytes(&id, &root->id, sizeof(id)) || basic.dwFileAttributes != root->attributes ||
      basic.nNumberOfLinks != root->links || security_length != root->security_length ||
      !equal_bytes(security, root->security, security_length)) {
    if (!HeapFree(GetProcessHeap(), 0U, security)) root->resource_ambiguous = 1;
    return 0;
  }
  if (!HeapFree(GetProcessHeap(), 0U, security)) root->resource_ambiguous = 1;
  return probe_root_path(root);
}

static int retain_root(const WCHAR *path, WORD path_units, ROOT_CUSTODY *root) {
  BOOL value = FALSE;
  DWORD returned = 0;
  BYTE restricted[sizeof(TOKEN_GROUPS)];
  HANDLE thread_token = NULL;
  WCHAR volume[] = L"C:\\";
  DWORD root_sharing = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
  zero_bytes(root, sizeof(*root));
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &root->token) ||
      !GetTokenInformation(root->token, TokenIsAppContainer, &value, sizeof(value), &returned) || value)
    return 0;
  if (OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, TRUE, &thread_token) || GetLastError() != ERROR_NO_TOKEN) {
    if (thread_token != NULL && !CloseHandle(thread_token)) root->resource_ambiguous = 1;
    return 0;
  }
  if (!GetTokenInformation(root->token, TokenRestrictedSids, restricted, sizeof(restricted), &returned) ||
      ((TOKEN_GROUPS *)restricted)->GroupCount != 0U ||
      !copy_token_sid(root, root->token, TokenUser, &root->stable_sid, &root->stable_sid_length) ||
      !copy_token_sid(root, root->token, TokenIntegrityLevel, &root->integrity_sid,
                      &root->integrity_sid_length))
    return 0;
  root->path_units = path_units;
  copy_bytes(root->path, path, ((SIZE_T)path_units + 1U) * 2U);
  volume[0] = path[4];
  if (GetDriveTypeW(volume) != DRIVE_FIXED) return 0;
  root->handle = CreateFileW(path, FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | READ_CONTROL | GENERIC_WRITE,
                             root_sharing,
                             NULL, OPEN_EXISTING,
                             FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  if (root->handle == INVALID_HANDLE_VALUE) return 0;
  return root_snapshot(root, 1);
}

static int release_root(ROOT_CUSTODY *root) {
  int clean = !root->resource_ambiguous;
  if (root->security != NULL && !HeapFree(GetProcessHeap(), 0U, root->security)) clean = 0;
  if (root->integrity_sid != NULL &&
      !HeapFree(GetProcessHeap(), 0U, root->integrity_sid)) clean = 0;
  if (root->stable_sid != NULL && !HeapFree(GetProcessHeap(), 0U, root->stable_sid)) clean = 0;
  if (root->handle != NULL && root->handle != INVALID_HANDLE_VALUE &&
      !CloseHandle(root->handle)) clean = 0;
  if (root->token != NULL && !CloseHandle(root->token)) clean = 0;
  zero_bytes(root, sizeof(*root));
  return clean;
}

static int append_wide(WCHAR *target, DWORD capacity, DWORD *cursor, const WCHAR *value);

static int path_contains(const WCHAR *parent, WORD parent_units,
                         const WCHAR *child, WORD child_units) {
  DWORD index;
  if (child_units <= parent_units) return 0;
  for (index = 0U; index < parent_units; index += 1U)
    if (parent[index] != child[index]) return 0;
  return child[parent_units] == L'\\';
}

static int same_path(const WCHAR *left, WORD left_units,
                     const WCHAR *right, WORD right_units) {
  return left_units == right_units &&
         equal_bytes(left, right, (DWORD)left_units * 2U);
}

static int hash_file_handle(ROOT_CUSTODY *root, HANDLE file, ULONGLONG size,
                            BYTE digest[32]) {
  BCRYPT_ALG_HANDLE algorithm = NULL;
  BCRYPT_HASH_HANDLE hash = NULL;
  BYTE *object = NULL;
  BYTE *buffer = NULL;
  DWORD object_length = 0U;
  DWORD returned = 0U;
  ULONGLONG remaining = size;
  int valid = 0;
  SetLastError(ERROR_SUCCESS);
  if ((SetFilePointer(file, 0, NULL, FILE_BEGIN) == INVALID_SET_FILE_POINTER &&
       GetLastError() != ERROR_SUCCESS) ||
      BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, NULL, 0U) < 0 ||
      BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, (PUCHAR)&object_length,
                        sizeof(object_length), &returned, 0U) < 0 ||
      returned != sizeof(object_length) || object_length == 0U)
    goto done;
  object = (BYTE *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, object_length);
  buffer = (BYTE *)HeapAlloc(GetProcessHeap(), 0U, 65536U);
  if (object == NULL || buffer == NULL ||
      BCryptCreateHash(algorithm, &hash, object, object_length, NULL, 0U, 0U) < 0)
    goto done;
  while (remaining != 0U) {
    DWORD requested = remaining > 65536U ? 65536U : (DWORD)remaining;
    DWORD received = 0U;
    if (!ReadFile(file, buffer, requested, &received, NULL) || received != requested ||
        BCryptHashData(hash, buffer, received, 0U) < 0)
      goto done;
    remaining -= received;
  }
  {
    BYTE trailing;
    DWORD received = 0U;
    if (!ReadFile(file, &trailing, 1U, &received, NULL) || received != 0U ||
        BCryptFinishHash(hash, digest, 32U, 0U) < 0)
      goto done;
  }
  valid = 1;
done:
  if (hash != NULL && BCryptDestroyHash(hash) < 0) root->resource_ambiguous = 1;
  if (algorithm != NULL && BCryptCloseAlgorithmProvider(algorithm, 0U) < 0)
    root->resource_ambiguous = 1;
  if (object != NULL && !HeapFree(GetProcessHeap(), 0U, object)) root->resource_ambiguous = 1;
  if (buffer != NULL && !HeapFree(GetProcessHeap(), 0U, buffer)) root->resource_ambiguous = 1;
  return valid && !root->resource_ambiguous;
}

static int retained_object_binding(ROOT_CUSTODY *root, RETAINED_OBJECT *object,
                                   const CHAR *domain, BYTE role, BYTE digest[32]) {
  BYTE content_digest[32];
  DWORD domain_bytes = (DWORD)ascii_length(domain) + 1U;
  DWORD path_bytes = (DWORD)object->path_units * 2U;
  DWORD material_length = domain_bytes + 1U + 4U + path_bytes + 8U + 16U +
                          4U + 4U + 8U + 4U + object->security_length + 32U;
  BYTE *material;
  DWORD cursor = 0U;
  if (object->size != 0U &&
      !hash_file_handle(root, object->handle, object->size, content_digest))
    return 0;
  if (object->size == 0U) zero_bytes(content_digest, sizeof(content_digest));
  material = (BYTE *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, material_length);
  if (material == NULL) return 0;
  copy_bytes(material + cursor, domain, domain_bytes); cursor += domain_bytes;
  material[cursor++] = role;
  write_u32(material + cursor, path_bytes); cursor += 4U;
  copy_bytes(material + cursor, object->path, path_bytes); cursor += path_bytes;
  write_u64(material + cursor, object->id.VolumeSerialNumber); cursor += 8U;
  copy_bytes(material + cursor, object->id.FileId.Identifier, 16U); cursor += 16U;
  write_u32(material + cursor, object->attributes); cursor += 4U;
  write_u32(material + cursor, object->links); cursor += 4U;
  write_u64(material + cursor, object->size); cursor += 8U;
  write_u32(material + cursor, object->security_length); cursor += 4U;
  copy_bytes(material + cursor, object->security, object->security_length);
  cursor += object->security_length;
  copy_bytes(material + cursor, content_digest, 32U);
  if (!sha256(material, material_length, digest, &root->resource_ambiguous)) {
    if (!HeapFree(GetProcessHeap(), 0U, material)) root->resource_ambiguous = 1;
    return 0;
  }
  if (!HeapFree(GetProcessHeap(), 0U, material)) root->resource_ambiguous = 1;
  return !root->resource_ambiguous;
}

static int retained_object_facts(ROOT_CUSTODY *root, HANDLE handle,
                                 const RETAINED_OBJECT *expected,
                                 FILE_ID_INFO *id,
                                 BY_HANDLE_FILE_INFORMATION *basic,
                                 ULONGLONG *size,
                                 PSECURITY_DESCRIPTOR *security,
                                 DWORD *security_length) {
  WCHAR final_path[PATH_MAX_UNITS + 1U];
  DWORD final_units;
  LARGE_INTEGER observed_size;
  int directory =
      (expected->attributes & FILE_ATTRIBUTE_DIRECTORY) != 0U;
  if (!GetFileInformationByHandleEx(handle, FileIdInfo, id, sizeof(*id)) ||
      !GetFileInformationByHandle(handle, basic))
    return 0;
  final_units = GetFinalPathNameByHandleW(
      handle, final_path, PATH_MAX_UNITS + 1U,
      FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  if (final_units != expected->path_units || final_units > PATH_MAX_UNITS ||
      !wide_equal(final_path, expected->path) ||
      basic->nNumberOfLinks != 1U ||
      !!(basic->dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != !!directory ||
      (basic->dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0U ||
      !capture_security(root, handle, security, security_length))
    return 0;
  if (directory) {
    *size = 0U;
  } else {
    if (!GetFileSizeEx(handle, &observed_size) || observed_size.QuadPart <= 0 ||
        (ULONGLONG)observed_size.QuadPart > EXECUTION_MAX_FILE_BYTES)
      return 0;
    *size = (ULONGLONG)observed_size.QuadPart;
  }
  return 1;
}

static int close_find_handle(ROOT_CUSTODY *root, HANDLE find) {
  if (!FindClose(find)) {
    root->resource_ambiguous = 1;
    return 0;
  }
  return 1;
}

static int directory_empty(ROOT_CUSTODY *root,
                           const RETAINED_OBJECT *directory) {
  WCHAR pattern[1200];
  DWORD cursor = 0U;
  HANDLE find;
  WIN32_FIND_DATAW data;
  int empty = 1;
  if (!append_wide(pattern, 1200U, &cursor, directory->path) ||
      !append_wide(pattern, 1200U, &cursor, L"\\*"))
    return 0;
  find = FindFirstFileW(pattern, &data);
  if (find == INVALID_HANDLE_VALUE)
    return GetLastError() == ERROR_FILE_NOT_FOUND;
  for (;;) {
    if (!wide_equal(data.cFileName, L".") && !wide_equal(data.cFileName, L"..")) {
      empty = 0;
      break;
    }
    if (!FindNextFileW(find, &data)) {
      if (GetLastError() != ERROR_NO_MORE_FILES) empty = 0;
      break;
    }
  }
  if (!close_find_handle(root, find)) return 0;
  return empty;
}

static int directory_fixed_census(ROOT_CUSTODY *root,
                                  const RETAINED_OBJECT *directory) {
  static const WCHAR *names[EXECUTION_ROLE_COUNT] = {
    L"node.exe", L"rpc-runner.mjs", L"candidate.mjs"
  };
  WCHAR pattern[1200];
  DWORD cursor = 0U;
  DWORD seen = 0U;
  HANDLE find;
  WIN32_FIND_DATAW data;
  if (!append_wide(pattern, 1200U, &cursor, directory->path) ||
      !append_wide(pattern, 1200U, &cursor, L"\\*"))
    return 0;
  find = FindFirstFileW(pattern, &data);
  if (find == INVALID_HANDLE_VALUE) return 0;
  for (;;) {
    if (!wide_equal(data.cFileName, L".") && !wide_equal(data.cFileName, L"..")) {
      DWORD role;
      if ((data.dwFileAttributes &
           (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0U) {
        seen = 0U;
        break;
      }
      for (role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U)
        if (wide_equal(data.cFileName, names[role])) break;
      if (role == EXECUTION_ROLE_COUNT || (seen & (1U << role)) != 0U) {
        seen = 0U;
        break;
      }
      seen |= 1U << role;
    }
    if (!FindNextFileW(find, &data)) {
      if (GetLastError() != ERROR_NO_MORE_FILES) seen = 0U;
      break;
    }
  }
  if (!close_find_handle(root, find)) return 0;
  return seen == 7U;
}

static int exact_unnamed_stream(ROOT_CUSTODY *root,
                                const RETAINED_OBJECT *object) {
  WIN32_FIND_STREAM_DATA data;
  HANDLE find = FindFirstStreamW(object->path, 0U, &data, 0U);
  int valid;
  int directory =
      (object->attributes & FILE_ATTRIBUTE_DIRECTORY) != 0U;
  if (find == INVALID_HANDLE_VALUE)
    return directory && GetLastError() == ERROR_HANDLE_EOF;
  valid = wide_equal(data.cStreamName, L"::$DATA") &&
          data.StreamSize.QuadPart >= 0 &&
          (ULONGLONG)data.StreamSize.QuadPart == object->size &&
          !FindNextStreamW(find, &data) && GetLastError() == ERROR_HANDLE_EOF;
  if (!close_find_handle(root, find)) return 0;
  return valid;
}

static int verify_retained_object(ROOT_CUSTODY *root, RETAINED_OBJECT *object,
                                  const CHAR *domain, BYTE role,
                                  const BYTE expected_binding[32]) {
  FILE_ID_INFO retained_id;
  FILE_ID_INFO probe_id;
  BY_HANDLE_FILE_INFORMATION retained_basic;
  BY_HANDLE_FILE_INFORMATION probe_basic;
  ULONGLONG retained_size = 0U;
  ULONGLONG probe_size = 0U;
  PSECURITY_DESCRIPTOR retained_security = NULL;
  PSECURITY_DESCRIPTOR retained_security_after = NULL;
  PSECURITY_DESCRIPTOR probe_security = NULL;
  DWORD retained_security_length = 0U;
  DWORD retained_security_after_length = 0U;
  DWORD probe_security_length = 0U;
  HANDLE probe = INVALID_HANDLE_VALUE;
  BYTE observed_binding[32];
  DWORD access = GENERIC_READ | FILE_READ_ATTRIBUTES | READ_CONTROL;
  DWORD flags = FILE_FLAG_OPEN_REPARSE_POINT |
                ((object->attributes & FILE_ATTRIBUTE_DIRECTORY) != 0U
                     ? FILE_FLAG_BACKUP_SEMANTICS
                     : FILE_FLAG_SEQUENTIAL_SCAN);
  int valid = 0;
  if (object->handle == NULL || object->handle == INVALID_HANDLE_VALUE ||
      !retained_object_facts(root, object->handle, object, &retained_id,
                             &retained_basic, &retained_size,
                             &retained_security, &retained_security_length))
    goto done;
  probe = CreateFileW(object->path, access,
                      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                      NULL,
                      OPEN_EXISTING, flags, NULL);
  if (probe == INVALID_HANDLE_VALUE ||
      !retained_object_facts(root, probe, object, &probe_id, &probe_basic,
                             &probe_size, &probe_security,
                             &probe_security_length) ||
      !equal_bytes(&retained_id, &object->id, sizeof(retained_id)) ||
      !equal_bytes(&probe_id, &retained_id, sizeof(probe_id)) ||
      retained_basic.dwFileAttributes != object->attributes ||
      probe_basic.dwFileAttributes != retained_basic.dwFileAttributes ||
      retained_basic.nNumberOfLinks != object->links ||
      probe_basic.nNumberOfLinks != retained_basic.nNumberOfLinks ||
      retained_size != object->size || probe_size != retained_size ||
      retained_security_length != object->security_length ||
      probe_security_length != retained_security_length ||
      !equal_bytes(retained_security, object->security,
                   retained_security_length) ||
      !equal_bytes(probe_security, retained_security,
                   retained_security_length) ||
      !exact_unnamed_stream(root, object) ||
      !retained_object_facts(root, object->handle, object, &retained_id,
                             &retained_basic, &retained_size,
                             &retained_security_after,
                             &retained_security_after_length) ||
      !equal_bytes(&retained_id, &object->id, sizeof(retained_id)) ||
      retained_basic.dwFileAttributes != object->attributes ||
      retained_basic.nNumberOfLinks != object->links ||
      retained_size != object->size ||
      retained_security_after_length != object->security_length ||
      !equal_bytes(retained_security_after, object->security,
                   retained_security_after_length) ||
      !retained_object_binding(root, object, domain, role,
                               observed_binding) ||
      !equal_bytes(observed_binding, expected_binding, 32U))
    goto done;
  valid = 1;
done:
  if (retained_security != NULL &&
      !HeapFree(GetProcessHeap(), 0U, retained_security))
    root->resource_ambiguous = 1;
  if (retained_security_after != NULL &&
      !HeapFree(GetProcessHeap(), 0U, retained_security_after))
    root->resource_ambiguous = 1;
  if (probe_security != NULL &&
      !HeapFree(GetProcessHeap(), 0U, probe_security))
    root->resource_ambiguous = 1;
  if (probe != INVALID_HANDLE_VALUE && !CloseHandle(probe))
    root->resource_ambiguous = 1;
  return valid && !root->resource_ambiguous;
}

static int retain_exact_object(ROOT_CUSTODY *root, const WCHAR *path, WORD path_units,
                               int directory, int require_empty, int deletable,
                               RETAINED_OBJECT *object,
                               const CHAR *domain, BYTE role) {
  WCHAR expected_path[PATH_MAX_UNITS + 1U];
  WCHAR volume[] = L"C:\\";
  WCHAR final_path[PATH_MAX_UNITS + 1U];
  DWORD final_units;
  BY_HANDLE_FILE_INFORMATION basic;
  LARGE_INTEGER size;
  DWORD access = GENERIC_READ | FILE_READ_ATTRIBUTES | READ_CONTROL |
                 (directory ? GENERIC_WRITE : 0U) | (deletable ? DELETE : 0U);
  DWORD flags = FILE_FLAG_OPEN_REPARSE_POINT |
                (directory ? FILE_FLAG_BACKUP_SEMANTICS : FILE_FLAG_SEQUENTIAL_SCAN);
  copy_bytes(expected_path, path, ((DWORD)path_units + 1U) * 2U);
  zero_bytes(object, sizeof(*object));
  object->handle = INVALID_HANDLE_VALUE;
  volume[0] = expected_path[4];
  if (GetDriveTypeW(volume) != DRIVE_FIXED) return 0;
  object->handle = CreateFileW(expected_path, access, FILE_SHARE_READ, NULL, OPEN_EXISTING,
                               flags, NULL);
  if (object->handle == INVALID_HANDLE_VALUE ||
      !GetFileInformationByHandleEx(object->handle, FileIdInfo, &object->id,
                                    sizeof(object->id)) ||
      !GetFileInformationByHandle(object->handle, &basic))
    return 0;
  final_units = GetFinalPathNameByHandleW(object->handle, final_path,
                                         PATH_MAX_UNITS + 1U,
                                         FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  if (final_units != path_units || final_units > PATH_MAX_UNITS ||
      !wide_equal(final_path, expected_path) || basic.nNumberOfLinks != 1U ||
      !!(basic.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != !!directory ||
      (basic.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0U ||
      !capture_security(root, object->handle, &object->security,
                        &object->security_length))
    return 0;
  object->path_units = path_units;
  copy_bytes(object->path, expected_path, ((DWORD)path_units + 1U) * 2U);
  object->attributes = basic.dwFileAttributes;
  object->links = basic.nNumberOfLinks;
  if (!directory) {
    if (!GetFileSizeEx(object->handle, &size) || size.QuadPart <= 0 ||
        (ULONGLONG)size.QuadPart > EXECUTION_MAX_FILE_BYTES)
      return 0;
    object->size = (ULONGLONG)size.QuadPart;
  } else if (require_empty && !directory_empty(root, object)) {
    return 0;
  }
  if (!exact_unnamed_stream(root, object) ||
      !retained_object_binding(root, object, domain, role, object->binding))
    return 0;
  return verify_retained_object(root, object, domain, role, object->binding);
}

static int release_retained_object(ROOT_CUSTODY *root, RETAINED_OBJECT *object) {
  int clean = 1;
  if (object->security != NULL &&
      !HeapFree(GetProcessHeap(), 0U, object->security)) clean = 0;
  if (object->handle != NULL && object->handle != INVALID_HANDLE_VALUE &&
      !CloseHandle(object->handle)) clean = 0;
  zero_bytes(object, sizeof(*object));
  object->handle = INVALID_HANDLE_VALUE;
  if (!clean) root->resource_ambiguous = 1;
  return clean;
}

static int append_wide(WCHAR *target, DWORD capacity, DWORD *cursor, const WCHAR *value) {
  DWORD index = 0;
  while (value[index] != L'\0') {
    if (*cursor + 1U >= capacity) return 0;
    target[*cursor] = value[index];
    *cursor += 1U;
    index += 1U;
  }
  target[*cursor] = L'\0';
  return 1;
}

static void hex_token(const BYTE token[32], WCHAR output[65]) {
  static const WCHAR digits[] = L"0123456789abcdef";
  DWORD index;
  for (index = 0; index < 32U; index += 1U) {
    output[index * 2U] = digits[token[index] >> 4U];
    output[index * 2U + 1U] = digits[token[index] & 15U];
  }
  output[64] = L'\0';
}

static int journal_path(const ROOT_CUSTODY *root, const BYTE token[32], BYTE kind, int pending,
                        WCHAR path[1200]) {
  static const WCHAR *suffix[] = {
    L"", L"-00-used.opwj", L"-01-profile-attempted.opwj", L"-02-profile-created.opwj",
    L"-03-profile-delete-attempted.opwj", L"-04-profile-absence-proved.opwj"
  };
  WCHAR hex[65];
  DWORD cursor = 0;
  if (kind < JOURNAL_USED || kind > JOURNAL_PROFILE_ABSENCE_PROVED) return 0;
  hex_token(token, hex);
  return append_wide(path, 1200U, &cursor, root->path) &&
         append_wide(path, 1200U, &cursor, L"\\windows-profile-") &&
         append_wide(path, 1200U, &cursor, hex) && append_wide(path, 1200U, &cursor, suffix[kind]) &&
         (!pending || append_wide(path, 1200U, &cursor, L".pending"));
}

static int file_security(ROOT_CUSTODY *root, PSECURITY_DESCRIPTOR *security) {
  LPWSTR stable = NULL;
  LPWSTR integrity = NULL;
  WCHAR sddl[1024];
  DWORD cursor = 0;
  if (!ConvertSidToStringSidW(root->stable_sid, &stable) ||
      !ConvertSidToStringSidW(root->integrity_sid, &integrity))
    goto failed;
  if (!append_wide(sddl, 1024U, &cursor, L"O:") || !append_wide(sddl, 1024U, &cursor, stable) ||
      !append_wide(sddl, 1024U, &cursor, L"G:SYD:P(A;;FA;;;") ||
      !append_wide(sddl, 1024U, &cursor, stable) ||
      !append_wide(sddl, 1024U, &cursor, L")(A;;FA;;;SY)S:(ML;;NW;;;") ||
      !append_wide(sddl, 1024U, &cursor, integrity) || !append_wide(sddl, 1024U, &cursor, L")") ||
      !ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1, security, NULL))
    goto failed;
  if (LocalFree(stable) != NULL) root->resource_ambiguous = 1;
  if (LocalFree(integrity) != NULL) root->resource_ambiguous = 1;
  return 1;
failed:
  if (stable != NULL && LocalFree(stable) != NULL) root->resource_ambiguous = 1;
  if (integrity != NULL && LocalFree(integrity) != NULL) root->resource_ambiguous = 1;
  return 0;
}

static DWORD journal_record(const ROOT_CUSTODY *root, const PROFILE_IDENTITY *identity, BYTE kind,
                            BYTE *record, DWORD capacity) {
  DWORD folder_bytes = (DWORD)identity->folder_units * 2U;
  DWORD needed = 12U + 32U + 32U + 32U + 64U + 2U + identity->sid_length + 2U +
                 identity->sid_text_length + 2U + folder_bytes +
                 (kind >= JOURNAL_PROFILE_CREATED ? 32U : 0U);
  DWORD cursor = 12U;
  DWORD index;
  if (needed > capacity || (kind <= JOURNAL_PROFILE_ATTEMPTED && identity->folder_units != 0U) ||
      (kind >= JOURNAL_PROFILE_CREATED && identity->folder_units == 0U))
    return 0U;
  zero_bytes(record, needed);
  record[0] = 'O'; record[1] = 'P'; record[2] = 'W'; record[3] = 'J';
  record[4] = 1U; record[5] = kind;
  write_u32(record + 8U, needed);
  copy_bytes(record + cursor, identity->token, 32U); cursor += 32U;
  if (kind != JOURNAL_USED) copy_bytes(record + cursor, identity->prior_digest, 32U);
  cursor += 32U;
  copy_bytes(record + cursor, root->digest, 32U); cursor += 32U;
  for (index = 0; index < MONIKER_BYTES; index += 1U)
    record[cursor + index] = (BYTE)identity->moniker[index];
  cursor += MONIKER_BYTES;
  write_u16(record + cursor, identity->sid_length); cursor += 2U;
  copy_bytes(record + cursor, identity->sid, identity->sid_length); cursor += identity->sid_length;
  write_u16(record + cursor, identity->sid_text_length); cursor += 2U;
  copy_bytes(record + cursor, identity->sid_text, identity->sid_text_length); cursor += identity->sid_text_length;
  write_u16(record + cursor, identity->folder_units); cursor += 2U;
  copy_bytes(record + cursor, identity->folder, folder_bytes); cursor += folder_bytes;
  if (kind >= JOURNAL_PROFILE_CREATED) copy_bytes(record + cursor, identity->folder_binding, 32U);
  return needed;
}

static int secure_record_handle(HANDLE file, ROOT_CUSTODY *root);

static int verify_leaf_handle(ROOT_CUSTODY *root, HANDLE file, const WCHAR *path,
                              const BYTE *expected, DWORD length, FILE_ID_INFO *identity,
                              int compare_identity) {
  BY_HANDLE_FILE_INFORMATION information;
  FILE_ID_INFO file_id;
  WCHAR final_path[1200];
  DWORD final_units;
  BYTE *actual;
  DWORD read = 0;
  int result = 0;
  DWORD pointer;
  final_units = GetFinalPathNameByHandleW(file, final_path, 1200U,
                                         FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  if (!GetFileInformationByHandle(file, &information) ||
      !GetFileInformationByHandleEx(file, FileIdInfo, &file_id, sizeof(file_id)) ||
      final_units != wide_length(path) || final_units >= 1200U || !wide_equal(final_path, path) ||
      information.nNumberOfLinks != 1U ||
      (information.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0U ||
      information.nFileSizeHigh != 0U || information.nFileSizeLow != length ||
      !secure_record_handle(file, root) ||
      (compare_identity && !equal_bytes(identity, &file_id, sizeof(file_id))))
    return 0;
  SetLastError(ERROR_SUCCESS);
  pointer = SetFilePointer(file, 0, NULL, FILE_BEGIN);
  if (pointer == INVALID_SET_FILE_POINTER && GetLastError() != ERROR_SUCCESS) return 0;
  actual = (BYTE *)HeapAlloc(GetProcessHeap(), 0U, length);
  if (actual == NULL) return 0;
  if (ReadFile(file, actual, length, &read, NULL) && read == length && equal_bytes(actual, expected, length)) {
    result = 1;
    if (identity != NULL) copy_bytes(identity, &file_id, sizeof(file_id));
  }
  if (!HeapFree(GetProcessHeap(), 0U, actual)) root->resource_ambiguous = 1;
  return result;
}

static int discard_open_pending(ROOT_CUSTODY *root, HANDLE file, const WCHAR *path) {
  FILE_DISPOSITION_INFO disposition;
  int clean = 1;
  disposition.DeleteFile = TRUE;
  if (!SetFileInformationByHandle(file, FileDispositionInfo, &disposition,
                                  sizeof(disposition)))
    clean = 0;
  if (!CloseHandle(file)) {
    root->resource_ambiguous = 1;
    clean = 0;
  }
  if (!FlushFileBuffers(root->handle)) clean = 0;
  if (GetFileAttributesW(path) != INVALID_FILE_ATTRIBUTES ||
      (GetLastError() != ERROR_FILE_NOT_FOUND && GetLastError() != ERROR_PATH_NOT_FOUND))
    clean = 0;
  if (!root_snapshot(root, 0)) clean = 0;
  return clean;
}

static int persist_phase(ROOT_CUSTODY *root, PROFILE_IDENTITY *identity, BYTE kind) {
  BYTE record[4096];
  DWORD length = journal_record(root, identity, kind, record, sizeof(record));
  WCHAR pending[1200];
  WCHAR final[1200];
  HANDLE file;
  DWORD written = 0;
  PSECURITY_DESCRIPTOR security = NULL;
  SECURITY_ATTRIBUTES attributes;
  FILE_RENAME_INFO *rename_information;
  FILE_ID_INFO file_identity;
  DWORD rename_bytes;
  int renamed;
  if (length == 0U || !root_snapshot(root, 0) || !journal_path(root, identity->token, kind, 1, pending) ||
      !journal_path(root, identity->token, kind, 0, final) || !file_security(root, &security))
    return 0;
  attributes.nLength = sizeof(attributes);
  attributes.lpSecurityDescriptor = security;
  attributes.bInheritHandle = FALSE;
  file = CreateFileW(pending, GENERIC_READ | GENERIC_WRITE | DELETE | SYNCHRONIZE, 0U, &attributes,
                     CREATE_NEW, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH |
                     FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  if (LocalFree(security) != NULL) root->resource_ambiguous = 1;
  if (file == INVALID_HANDLE_VALUE) return 0;
  if (!root_snapshot(root, 0) || !WriteFile(file, record, length, &written, NULL) ||
      written != length || !root_snapshot(root, 0) || !FlushFileBuffers(file) ||
      !verify_leaf_handle(root, file, pending, record, length, &file_identity, 0) ||
      !root_snapshot(root, 0)) {
    if (!discard_open_pending(root, file, pending)) root->resource_ambiguous = 1;
    return 0;
  }
  {
    DWORD final_bytes = (DWORD)wide_length(final) * 2U;
    rename_bytes = (DWORD)sizeof(FILE_RENAME_INFO) + final_bytes;
    rename_information = (FILE_RENAME_INFO *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY,
                                                       rename_bytes);
    if (rename_information == NULL) {
      if (!discard_open_pending(root, file, pending)) root->resource_ambiguous = 1;
      return 0;
    }
    rename_information->ReplaceIfExists = (BOOL)FILE_RENAME_FLAG_POSIX_SEMANTICS;
    rename_information->RootDirectory = NULL;
    rename_information->FileNameLength = final_bytes;
    copy_bytes(rename_information->FileName, final, final_bytes);
    renamed = SetFileInformationByHandle(file, FileRenameInfoEx, rename_information, rename_bytes);
    if (!HeapFree(GetProcessHeap(), 0U, rename_information)) root->resource_ambiguous = 1;
  }
  if (!renamed) {
    if (!discard_open_pending(root, file, pending)) root->resource_ambiguous = 1;
    return 0;
  }
  if (!verify_leaf_handle(root, file, final, record, length, &file_identity, 1) ||
      GetFileAttributesW(pending) != INVALID_FILE_ATTRIBUTES || GetLastError() != ERROR_FILE_NOT_FOUND ||
      !FlushFileBuffers(root->handle) || !root_snapshot(root, 0)) {
    if (!CloseHandle(file)) root->resource_ambiguous = 1;
    return 0;
  }
  if (!CloseHandle(file) || !root_snapshot(root, 0)) {
    return 0;
  }
  file = CreateFileW(final, GENERIC_READ | READ_CONTROL, 0U, NULL, OPEN_EXISTING,
                     FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN, NULL);
  if (file == INVALID_HANDLE_VALUE ||
      !verify_leaf_handle(root, file, final, record, length, &file_identity, 1)) {
    if (file != INVALID_HANDLE_VALUE && !CloseHandle(file)) root->resource_ambiguous = 1;
    return 0;
  }
  if (!CloseHandle(file) || !root_snapshot(root, 0) ||
      !sha256(record, length, identity->prior_digest, &root->resource_ambiguous))
    return 0;
  identity->phase = kind;
  return 1;
}

static int execution_journal_path(const ROOT_CUSTODY *root, const BYTE token[32],
                                  BYTE kind, int pending, WCHAR path[1200]) {
  static const WCHAR *suffix[] = {
    L"", L"-00-attempted.opwx", L"-01-created.opwx",
    L"-02-delete-attempted.opwx", L"-03-absence-proved.opwx"
  };
  WCHAR hex[65];
  DWORD cursor = 0U;
  if (kind < EXECUTION_ATTEMPTED || kind > EXECUTION_ABSENCE_PROVED) return 0;
  hex_token(token, hex);
  return append_wide(path, 1200U, &cursor, root->path) &&
         append_wide(path, 1200U, &cursor, L"\\windows-execution-") &&
         append_wide(path, 1200U, &cursor, hex) &&
         append_wide(path, 1200U, &cursor, suffix[kind]) &&
         (!pending || append_wide(path, 1200U, &cursor, L".pending"));
}

static DWORD execution_record(const ROOT_CUSTODY *root, const PROFILE_IDENTITY *identity,
                              const EXECUTION_CUSTODY *execution, BYTE kind,
                              BYTE *record, DWORD capacity) {
  DWORD parent_bytes = (DWORD)execution->parent.path_units * 2U;
  DWORD root_bytes = (DWORD)execution->root.path_units * 2U;
  DWORD needed = 12U + 32U + 32U + 32U + 32U + 2U + parent_bytes + 32U +
                 2U + root_bytes + 96U + 32U + 96U;
  DWORD cursor = 12U;
  int targets_nonzero = 1;
  int partial = equal_bytes(execution->root_binding, (BYTE[32]){0}, 32U) &&
                equal_bytes(execution->target_bindings, (BYTE[96]){0}, 96U);
  int complete;
  for (DWORD role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U)
    if (equal_bytes(execution->target_bindings[role], (BYTE[32]){0}, 32U))
      targets_nonzero = 0;
  complete = !equal_bytes(execution->root_binding, (BYTE[32]){0}, 32U) &&
             targets_nonzero;
  if (needed > capacity || execution->parent.path_units == 0U ||
      execution->root.path_units == 0U ||
      identity->phase < JOURNAL_PROFILE_CREATED ||
      (kind == EXECUTION_ATTEMPTED && (!partial || execution->phase != 0U)) ||
      (kind == EXECUTION_CREATED && (!complete || execution->phase != EXECUTION_ATTEMPTED)) ||
      (kind == EXECUTION_DELETE_ATTEMPTED &&
       !((execution->phase == EXECUTION_ATTEMPTED && partial) ||
         (execution->phase == EXECUTION_CREATED && complete))) ||
      (kind == EXECUTION_ABSENCE_PROVED &&
       (execution->phase != EXECUTION_DELETE_ATTEMPTED || (!partial && !complete))))
    return 0U;
  zero_bytes(record, needed);
  record[0] = 'O'; record[1] = 'P'; record[2] = 'W'; record[3] = 'X';
  record[4] = 1U; record[5] = kind;
  write_u32(record + 8U, needed);
  copy_bytes(record + cursor, identity->token, 32U); cursor += 32U;
  if (kind != EXECUTION_ATTEMPTED)
    copy_bytes(record + cursor, execution->prior_digest, 32U);
  cursor += 32U;
  copy_bytes(record + cursor, root->digest, 32U); cursor += 32U;
  copy_bytes(record + cursor, execution->profile_created_digest, 32U); cursor += 32U;
  write_u16(record + cursor, execution->parent.path_units); cursor += 2U;
  copy_bytes(record + cursor, execution->parent.path, parent_bytes); cursor += parent_bytes;
  copy_bytes(record + cursor, execution->parent.binding, 32U); cursor += 32U;
  write_u16(record + cursor, execution->root.path_units); cursor += 2U;
  copy_bytes(record + cursor, execution->root.path, root_bytes); cursor += root_bytes;
  copy_bytes(record + cursor, execution->source_bindings, 96U); cursor += 96U;
  copy_bytes(record + cursor, execution->root_binding, 32U);
  copy_bytes(record + cursor + 32U, execution->target_bindings, 96U);
  return needed;
}

static int persist_execution_phase(ROOT_CUSTODY *root, PROFILE_IDENTITY *identity,
                                   EXECUTION_CUSTODY *execution, BYTE kind) {
  BYTE record[4096];
  DWORD length = execution_record(root, identity, execution, kind, record,
                                  sizeof(record));
  WCHAR pending[1200];
  WCHAR final[1200];
  HANDLE file;
  DWORD written = 0U;
  PSECURITY_DESCRIPTOR security = NULL;
  SECURITY_ATTRIBUTES attributes;
  FILE_RENAME_INFO *rename_information;
  FILE_ID_INFO file_identity;
  DWORD rename_bytes;
  int renamed;
  if (length == 0U || !root_snapshot(root, 0) ||
      !execution_journal_path(root, identity->token, kind, 1, pending) ||
      !execution_journal_path(root, identity->token, kind, 0, final) ||
      !file_security(root, &security))
    return 0;
  attributes.nLength = sizeof(attributes);
  attributes.lpSecurityDescriptor = security;
  attributes.bInheritHandle = FALSE;
  file = CreateFileW(pending, GENERIC_READ | GENERIC_WRITE | DELETE | SYNCHRONIZE,
                     0U, &attributes, CREATE_NEW,
                     FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH |
                     FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  if (LocalFree(security) != NULL) root->resource_ambiguous = 1;
  if (file == INVALID_HANDLE_VALUE) return 0;
  if (!root_snapshot(root, 0) || !WriteFile(file, record, length, &written, NULL) ||
      written != length || !FlushFileBuffers(file) ||
      !verify_leaf_handle(root, file, pending, record, length, &file_identity, 0) ||
      !root_snapshot(root, 0)) {
    if (!discard_open_pending(root, file, pending)) root->resource_ambiguous = 1;
    return 0;
  }
  {
    DWORD final_bytes = (DWORD)wide_length(final) * 2U;
    rename_bytes = (DWORD)sizeof(FILE_RENAME_INFO) + final_bytes;
    rename_information = (FILE_RENAME_INFO *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY,
                                                       rename_bytes);
    if (rename_information == NULL) {
      if (!discard_open_pending(root, file, pending)) root->resource_ambiguous = 1;
      return 0;
    }
    rename_information->ReplaceIfExists = (BOOL)FILE_RENAME_FLAG_POSIX_SEMANTICS;
    rename_information->FileNameLength = final_bytes;
    copy_bytes(rename_information->FileName, final, final_bytes);
    renamed = SetFileInformationByHandle(file, FileRenameInfoEx,
                                         rename_information, rename_bytes);
    if (!HeapFree(GetProcessHeap(), 0U, rename_information)) root->resource_ambiguous = 1;
  }
  if (!renamed) {
    if (!discard_open_pending(root, file, pending))
      root->resource_ambiguous = 1;
    return 0;
  }
  if (!verify_leaf_handle(root, file, final, record, length,
                          &file_identity, 1) ||
      GetFileAttributesW(pending) != INVALID_FILE_ATTRIBUTES ||
      GetLastError() != ERROR_FILE_NOT_FOUND || !FlushFileBuffers(root->handle) ||
      !root_snapshot(root, 0)) {
    if (!CloseHandle(file)) root->resource_ambiguous = 1;
    return 0;
  }
  if (!CloseHandle(file))
    return 0;
  file = CreateFileW(final, GENERIC_READ | READ_CONTROL, 0U, NULL, OPEN_EXISTING,
                     FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN, NULL);
  if (file == INVALID_HANDLE_VALUE ||
      !verify_leaf_handle(root, file, final, record, length, &file_identity, 1)) {
    if (file != INVALID_HANDLE_VALUE && !CloseHandle(file)) root->resource_ambiguous = 1;
    return 0;
  }
  if (!CloseHandle(file) || !root_snapshot(root, 0) ||
      !sha256(record, length, execution->prior_digest, &root->resource_ambiguous))
    return 0;
  execution->phase = kind;
  return 1;
}

static int execution_target_path(const RETAINED_OBJECT *execution_root, BYTE role,
                                 WCHAR path[PATH_MAX_UNITS + 1U], WORD *units) {
  static const WCHAR *names[EXECUTION_ROLE_COUNT] = {
    L"node.exe", L"rpc-runner.mjs", L"candidate.mjs"
  };
  DWORD cursor = 0U;
  if (role >= EXECUTION_ROLE_COUNT ||
      !append_wide(path, PATH_MAX_UNITS + 1U, &cursor, execution_root->path) ||
      !append_wide(path, PATH_MAX_UNITS + 1U, &cursor, L"\\") ||
      !append_wide(path, PATH_MAX_UNITS + 1U, &cursor, names[role]) ||
      cursor > PATH_MAX_UNITS)
    return 0;
  *units = (WORD)cursor;
  return 1;
}

static int retain_execution_inputs(ROOT_CUSTODY *root,
                                   const EXECUTION_PREPARE_PATHS *paths,
                                   const PROFILE_IDENTITY *identity,
                                   EXECUTION_CUSTODY *execution) {
  DWORD role;
  WCHAR hex[65];
  DWORD cursor = 0U;
  zero_bytes(execution, sizeof(*execution));
  execution->parent.handle = INVALID_HANDLE_VALUE;
  execution->root.handle = INVALID_HANDLE_VALUE;
  for (role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U) {
    execution->sources[role].handle = INVALID_HANDLE_VALUE;
    execution->targets[role].handle = INVALID_HANDLE_VALUE;
  }
  if (same_path(paths->state_root, paths->state_root_units,
                paths->execution_parent, paths->execution_parent_units) ||
      path_contains(paths->state_root, paths->state_root_units,
                    paths->execution_parent, paths->execution_parent_units) ||
      path_contains(paths->execution_parent, paths->execution_parent_units,
                    paths->state_root, paths->state_root_units) ||
      !retain_exact_object(root, paths->execution_parent,
                           paths->execution_parent_units, 1, 1, 0,
                           &execution->parent,
                           "op.windows-execution-parent/v1", 0U))
    return 0;
  for (role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U) {
    DWORD other;
    if (path_contains(paths->state_root, paths->state_root_units,
                      paths->sources[role], paths->source_units[role]) ||
        path_contains(paths->execution_parent, paths->execution_parent_units,
                      paths->sources[role], paths->source_units[role]) ||
        same_path(paths->state_root, paths->state_root_units,
                  paths->sources[role], paths->source_units[role]) ||
        same_path(paths->execution_parent, paths->execution_parent_units,
                  paths->sources[role], paths->source_units[role]) ||
        !retain_exact_object(root, paths->sources[role],
                             paths->source_units[role], 0, 0, 0,
                             &execution->sources[role],
                             "op.windows-execution-source/v1", (BYTE)role))
      return 0;
    for (other = 0U; other < role; other += 1U)
      if (same_path(paths->sources[role], paths->source_units[role],
                    paths->sources[other], paths->source_units[other]) ||
          equal_bytes(&execution->sources[role].id,
                      &execution->sources[other].id, sizeof(FILE_ID_INFO)))
        return 0;
    copy_bytes(execution->source_bindings[role],
               execution->sources[role].binding, 32U);
  }
  copy_bytes(execution->profile_created_digest, identity->prior_digest, 32U);
  hex_token(identity->token, hex);
  if (!append_wide(execution->root.path, PATH_MAX_UNITS + 1U, &cursor,
                   execution->parent.path) ||
      !append_wide(execution->root.path, PATH_MAX_UNITS + 1U, &cursor,
                   L"\\orch6-execution-") ||
      !append_wide(execution->root.path, PATH_MAX_UNITS + 1U, &cursor, hex) ||
      cursor > PATH_MAX_UNITS)
    return 0;
  execution->root.path_units = (WORD)cursor;
  if (GetFileAttributesW(execution->root.path) != INVALID_FILE_ATTRIBUTES ||
      (GetLastError() != ERROR_FILE_NOT_FOUND && GetLastError() != ERROR_PATH_NOT_FOUND))
    return 0;
  return 1;
}

static int copy_execution_target(ROOT_CUSTODY *root, EXECUTION_CUSTODY *execution,
                                 BYTE role) {
  WCHAR path[PATH_MAX_UNITS + 1U];
  WORD path_units;
  PSECURITY_DESCRIPTOR security = NULL;
  SECURITY_ATTRIBUTES attributes;
  HANDLE target = INVALID_HANDLE_VALUE;
  BYTE *buffer = NULL;
  ULONGLONG remaining = execution->sources[role].size;
  int valid = 0;
  BYTE source_digest[32];
  BYTE target_digest[32];
  if (!verify_retained_object(root, &execution->sources[role],
                              "op.windows-execution-source/v1", role,
                              execution->source_bindings[role]) ||
      !execution_target_path(&execution->root, role, path, &path_units) ||
      !file_security(root, &security))
    return 0;
  attributes.nLength = sizeof(attributes);
  attributes.lpSecurityDescriptor = security;
  attributes.bInheritHandle = FALSE;
  target = CreateFileW(path, GENERIC_READ | GENERIC_WRITE | DELETE | SYNCHRONIZE,
                       0U, &attributes, CREATE_NEW,
                       FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH |
                       FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  if (LocalFree(security) != NULL) root->resource_ambiguous = 1;
  if (target == INVALID_HANDLE_VALUE) return 0;
  buffer = (BYTE *)HeapAlloc(GetProcessHeap(), 0U, 65536U);
  SetLastError(ERROR_SUCCESS);
  if (buffer == NULL ||
      (SetFilePointer(execution->sources[role].handle, 0, NULL, FILE_BEGIN) ==
         INVALID_SET_FILE_POINTER && GetLastError() != ERROR_SUCCESS))
    goto done;
  while (remaining != 0U) {
    DWORD requested = remaining > 65536U ? 65536U : (DWORD)remaining;
    DWORD received = 0U;
    DWORD written = 0U;
    if (!ReadFile(execution->sources[role].handle, buffer, requested,
                  &received, NULL) || received != requested ||
        !WriteFile(target, buffer, received, &written, NULL) || written != received)
      goto done;
    remaining -= received;
  }
  if (!FlushFileBuffers(target)) goto done;
  if (!CloseHandle(target)) {
    target = INVALID_HANDLE_VALUE;
    root->resource_ambiguous = 1;
    goto done;
  }
  target = INVALID_HANDLE_VALUE;
  if (!retain_exact_object(root, path, path_units, 0, 0, 1,
                           &execution->targets[role],
                           "op.windows-execution-target/v1", role) ||
      execution->targets[role].size != execution->sources[role].size ||
      !hash_file_handle(root, execution->sources[role].handle,
                        execution->sources[role].size, source_digest) ||
      !hash_file_handle(root, execution->targets[role].handle,
                        execution->targets[role].size, target_digest) ||
      !equal_bytes(source_digest, target_digest, 32U))
    goto done;
  if (!verify_retained_object(root, &execution->sources[role],
                              "op.windows-execution-source/v1", role,
                              execution->source_bindings[role]) ||
      !verify_retained_object(root, &execution->targets[role],
                              "op.windows-execution-target/v1", role,
                              execution->targets[role].binding))
    goto done;
  copy_bytes(execution->target_bindings[role],
             execution->targets[role].binding, 32U);
  valid = 1;
done:
  if (buffer != NULL && !HeapFree(GetProcessHeap(), 0U, buffer))
    root->resource_ambiguous = 1;
  if (target != INVALID_HANDLE_VALUE && !CloseHandle(target))
    root->resource_ambiguous = 1;
  return valid && !root->resource_ambiguous;
}

static int execution_root_binding(ROOT_CUSTODY *root,
                                  const PROFILE_IDENTITY *identity,
                                  EXECUTION_CUSTODY *execution) {
  BYTE root_object_binding[32];
  DWORD domain_bytes = (DWORD)ascii_length("op.windows-execution-root/v1") + 1U;
  DWORD length = domain_bytes + 32U + 32U + 32U + 96U + 96U;
  BYTE *material = (BYTE *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, length);
  DWORD cursor = 0U;
  if (material == NULL ||
      !verify_retained_object(root, &execution->root,
                              "op.windows-execution-root-object/v1", 0U,
                              execution->root.binding) ||
      !retained_object_binding(root, &execution->root,
                               "op.windows-execution-root-object/v1", 0U,
                               root_object_binding)) {
    if (material != NULL && !HeapFree(GetProcessHeap(), 0U, material))
      root->resource_ambiguous = 1;
    return 0;
  }
  copy_bytes(material + cursor, "op.windows-execution-root/v1", domain_bytes);
  cursor += domain_bytes;
  copy_bytes(material + cursor, identity->token, 32U); cursor += 32U;
  copy_bytes(material + cursor, execution->parent.binding, 32U); cursor += 32U;
  copy_bytes(material + cursor, root_object_binding, 32U); cursor += 32U;
  copy_bytes(material + cursor, execution->source_bindings, 96U); cursor += 96U;
  copy_bytes(material + cursor, execution->target_bindings, 96U);
  if (!sha256(material, length, execution->root_binding,
              &root->resource_ambiguous)) {
    if (!HeapFree(GetProcessHeap(), 0U, material)) root->resource_ambiguous = 1;
    return 0;
  }
  if (!HeapFree(GetProcessHeap(), 0U, material)) root->resource_ambiguous = 1;
  return !root->resource_ambiguous;
}

#if defined(OP_WINDOWS_PAUSE_AFTER_EXECUTION_ATTEMPTED) || \
    defined(OP_WINDOWS_PAUSE_AFTER_EXECUTION_MKDIR) || \
    defined(OP_WINDOWS_PAUSE_AFTER_EXECUTION_CREATED)
static void diagnostic_pause(void);
#endif

static int construct_execution(ROOT_CUSTODY *root, PROFILE_IDENTITY *identity,
                               EXECUTION_CUSTODY *execution) {
  PSECURITY_DESCRIPTOR security = NULL;
  SECURITY_ATTRIBUTES attributes;
  DWORD role;
  if (!verify_retained_object(root, &execution->parent,
                              "op.windows-execution-parent/v1", 0U,
                              execution->parent.binding))
    return 0;
  for (role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U)
    if (!verify_retained_object(root, &execution->sources[role],
                                "op.windows-execution-source/v1", (BYTE)role,
                                execution->source_bindings[role]))
      return 0;
  if (!persist_execution_phase(root, identity, execution, EXECUTION_ATTEMPTED) ||
      !file_security(root, &security))
    return 0;
#if defined(OP_WINDOWS_PAUSE_AFTER_EXECUTION_ATTEMPTED)
  diagnostic_pause();
#endif
  attributes.nLength = sizeof(attributes);
  attributes.lpSecurityDescriptor = security;
  attributes.bInheritHandle = FALSE;
  if (!CreateDirectoryW(execution->root.path, &attributes)) {
    if (LocalFree(security) != NULL) root->resource_ambiguous = 1;
    return 0;
  }
  if (LocalFree(security) != NULL) root->resource_ambiguous = 1;
#if defined(OP_WINDOWS_PAUSE_AFTER_EXECUTION_MKDIR)
  diagnostic_pause();
#endif
  if (!FlushFileBuffers(execution->parent.handle) ||
      !retain_exact_object(root, execution->root.path, execution->root.path_units,
                           1, 1, 1, &execution->root,
                           "op.windows-execution-root-object/v1", 0U))
    return 0;
  for (role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U)
    if (!copy_execution_target(root, execution, (BYTE)role)) return 0;
  for (role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U) {
    if (!verify_retained_object(root, &execution->sources[role],
                                "op.windows-execution-source/v1", (BYTE)role,
                                execution->source_bindings[role]) ||
        !verify_retained_object(root, &execution->targets[role],
                                "op.windows-execution-target/v1", (BYTE)role,
                                execution->target_bindings[role]))
      return 0;
  }
  if (!verify_retained_object(root, &execution->parent,
                              "op.windows-execution-parent/v1", 0U,
                              execution->parent.binding))
    return 0;
  if (!FlushFileBuffers(execution->root.handle) ||
      !directory_fixed_census(root, &execution->root) ||
      !execution_root_binding(root, identity, execution) ||
      !persist_execution_phase(root, identity, execution, EXECUTION_CREATED))
    return 0;
#if defined(OP_WINDOWS_PAUSE_AFTER_EXECUTION_CREATED)
  diagnostic_pause();
#endif
  return 1;
}

static int execution_subset_census(ROOT_CUSTODY *root,
                                   const RETAINED_OBJECT *directory,
                                   DWORD *seen_output) {
  static const WCHAR *names[EXECUTION_ROLE_COUNT] = {
    L"node.exe", L"rpc-runner.mjs", L"candidate.mjs"
  };
  WCHAR pattern[1200];
  DWORD cursor = 0U;
  DWORD seen = 0U;
  HANDLE find;
  WIN32_FIND_DATAW data;
  if (!append_wide(pattern, 1200U, &cursor, directory->path) ||
      !append_wide(pattern, 1200U, &cursor, L"\\*"))
    return 0;
  find = FindFirstFileW(pattern, &data);
  if (find == INVALID_HANDLE_VALUE) return GetLastError() == ERROR_FILE_NOT_FOUND;
  for (;;) {
    if (!wide_equal(data.cFileName, L".") && !wide_equal(data.cFileName, L"..")) {
      DWORD role;
      if ((data.dwFileAttributes &
           (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0U) {
        if (!close_find_handle(root, find)) return 0;
        return 0;
      }
      for (role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U)
        if (wide_equal(data.cFileName, names[role])) break;
      if (role == EXECUTION_ROLE_COUNT || (seen & (1U << role)) != 0U) {
        if (!close_find_handle(root, find)) return 0;
        return 0;
      }
      seen |= 1U << role;
    }
    if (!FindNextFileW(find, &data)) {
      if (GetLastError() != ERROR_NO_MORE_FILES) {
        if (!close_find_handle(root, find)) return 0;
        return 0;
      }
      break;
    }
  }
  if (!close_find_handle(root, find)) return 0;
  *seen_output = seen;
  return 1;
}

static int delete_retained_object(ROOT_CUSTODY *root,
                                  RETAINED_OBJECT *object);

static int delete_partial_target(ROOT_CUSTODY *root, EXECUTION_CUSTODY *execution,
                                 BYTE role) {
  WCHAR path[PATH_MAX_UNITS + 1U];
  WORD path_units;
  RETAINED_OBJECT observed;
  if (!execution_target_path(&execution->root, role, path, &path_units)) return 0;
  zero_bytes(&observed, sizeof(observed));
  observed.handle = INVALID_HANDLE_VALUE;
  if (!retain_exact_object(root, path, path_units, 0, 0, 1, &observed,
                           "op.windows-execution-target/v1", role)) {
    (void)release_retained_object(root, &observed);
    return 0;
  }
  if (!verify_retained_object(root, &observed,
                              "op.windows-execution-target/v1", role,
                              observed.binding) ||
      !delete_retained_object(root, &observed)) {
    (void)release_retained_object(root, &observed);
    return 0;
  }
  return 1;
}

static int delete_retained_object(ROOT_CUSTODY *root, RETAINED_OBJECT *object) {
  FILE_DISPOSITION_INFO disposition;
  WCHAR path[PATH_MAX_UNITS + 1U];
  WORD path_units = object->path_units;
  int clean = 1;
  if (object->handle == NULL || object->handle == INVALID_HANDLE_VALUE) return 0;
  copy_bytes(path, object->path, ((DWORD)path_units + 1U) * 2U);
  disposition.DeleteFile = TRUE;
  if (!SetFileInformationByHandle(object->handle, FileDispositionInfo,
                                  &disposition, sizeof(disposition)))
    clean = 0;
  if (!CloseHandle(object->handle)) clean = 0;
  object->handle = INVALID_HANDLE_VALUE;
  if (object->security != NULL &&
      !HeapFree(GetProcessHeap(), 0U, object->security)) clean = 0;
  object->security = NULL;
  if (GetFileAttributesW(path) != INVALID_FILE_ATTRIBUTES ||
      (GetLastError() != ERROR_FILE_NOT_FOUND && GetLastError() != ERROR_PATH_NOT_FOUND))
    clean = 0;
  if (!clean) root->resource_ambiguous = 1;
  return clean;
}

static int cleanup_execution(ROOT_CUSTODY *root, PROFILE_IDENTITY *identity,
                             EXECUTION_CUSTODY *execution) {
  int complete = execution->phase == EXECUTION_CREATED;
  DWORD role;
  DWORD subset = 0U;
  if (execution->phase != EXECUTION_ATTEMPTED &&
      execution->phase != EXECUTION_CREATED &&
      execution->phase != EXECUTION_DELETE_ATTEMPTED)
    return execution->phase == EXECUTION_ABSENCE_PROVED;
  if (execution->parent.handle == NULL || execution->parent.handle == INVALID_HANDLE_VALUE) {
    WCHAR parent_path[PATH_MAX_UNITS + 1U];
    WORD parent_units = execution->parent.path_units;
    BYTE expected_parent[32];
    copy_bytes(parent_path, execution->parent.path,
               ((DWORD)parent_units + 1U) * 2U);
    copy_bytes(expected_parent, execution->parent.binding, 32U);
    if (!retain_exact_object(root, parent_path, parent_units, 1, 0, 0,
                             &execution->parent,
                             "op.windows-execution-parent/v1", 0U) ||
        !equal_bytes(expected_parent, execution->parent.binding, 32U))
      return 0;
  }
  if (!verify_retained_object(root, &execution->parent,
                              "op.windows-execution-parent/v1", 0U,
                              execution->parent.binding))
    return 0;
  if (execution->phase == EXECUTION_CREATED) {
    BYTE expected_root[32];
    copy_bytes(expected_root, execution->root_binding, 32U);
    if (execution->root.handle == NULL || execution->root.handle == INVALID_HANDLE_VALUE) {
      WCHAR root_path[PATH_MAX_UNITS + 1U];
      WORD root_units = execution->root.path_units;
      copy_bytes(root_path, execution->root.path, ((DWORD)root_units + 1U) * 2U);
      if (!retain_exact_object(root, root_path, root_units, 1, 0, 1,
                               &execution->root,
                               "op.windows-execution-root-object/v1", 0U))
        return 0;
    }
    if (!directory_fixed_census(root, &execution->root)) return 0;
    for (role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U) {
      if (execution->targets[role].handle == NULL ||
          execution->targets[role].handle == INVALID_HANDLE_VALUE) {
        WCHAR target_path[PATH_MAX_UNITS + 1U];
        WORD target_units;
        BYTE expected_target[32];
        copy_bytes(expected_target, execution->target_bindings[role], 32U);
        if (!execution_target_path(&execution->root, (BYTE)role,
                                   target_path, &target_units) ||
            !retain_exact_object(root, target_path, target_units, 0, 0, 1,
                                 &execution->targets[role],
                                 "op.windows-execution-target/v1", (BYTE)role) ||
            !equal_bytes(expected_target, execution->targets[role].binding, 32U))
          return 0;
      }
      if (!verify_retained_object(root, &execution->targets[role],
                                  "op.windows-execution-target/v1", (BYTE)role,
                                  execution->target_bindings[role]))
        return 0;
    }
    if (!execution_root_binding(root, identity, execution) ||
        !equal_bytes(execution->root_binding, expected_root, 32U))
      return 0;
  }
  if (execution->phase != EXECUTION_DELETE_ATTEMPTED &&
      !persist_execution_phase(root, identity, execution,
                               EXECUTION_DELETE_ATTEMPTED))
    return 0;
  complete = !equal_bytes(execution->root_binding, (BYTE[32]){0}, 32U);
  if (GetFileAttributesW(execution->root.path) == INVALID_FILE_ATTRIBUTES) {
    if (GetLastError() != ERROR_FILE_NOT_FOUND && GetLastError() != ERROR_PATH_NOT_FOUND)
      return 0;
  } else {
    if (execution->root.handle == NULL || execution->root.handle == INVALID_HANDLE_VALUE) {
      WCHAR root_path[PATH_MAX_UNITS + 1U];
      WORD root_units = execution->root.path_units;
      copy_bytes(root_path, execution->root.path, ((DWORD)root_units + 1U) * 2U);
      if (!retain_exact_object(root, root_path, root_units, 1, 0, 1,
                               &execution->root,
                               "op.windows-execution-root-object/v1", 0U))
        return 0;
    }
    if (complete) {
      BYTE expected_root[32];
      copy_bytes(expected_root, execution->root_binding, 32U);
      if (!execution_subset_census(root, &execution->root, &subset)) return 0;
      for (role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U) {
        if ((subset & (1U << role)) == 0U) {
          WCHAR absent_path[PATH_MAX_UNITS + 1U];
          WORD absent_units;
          if (!execution_target_path(&execution->root, (BYTE)role,
                                     absent_path, &absent_units) ||
              GetFileAttributesW(absent_path) != INVALID_FILE_ATTRIBUTES ||
              (GetLastError() != ERROR_FILE_NOT_FOUND &&
               GetLastError() != ERROR_PATH_NOT_FOUND))
            return 0;
          continue;
        }
        if (execution->targets[role].handle == NULL ||
            execution->targets[role].handle == INVALID_HANDLE_VALUE) {
          WCHAR target_path[PATH_MAX_UNITS + 1U];
          WORD target_units;
          BYTE expected_target[32];
          copy_bytes(expected_target, execution->target_bindings[role], 32U);
          if (!execution_target_path(&execution->root, (BYTE)role,
                                     target_path, &target_units) ||
              !retain_exact_object(root, target_path, target_units, 0, 0, 1,
                                   &execution->targets[role],
                                   "op.windows-execution-target/v1",
                                   (BYTE)role) ||
              !equal_bytes(expected_target,
                           execution->targets[role].binding, 32U))
            return 0;
        }
        if (!verify_retained_object(root, &execution->targets[role],
                                    "op.windows-execution-target/v1",
                                    (BYTE)role,
                                    execution->target_bindings[role]))
          return 0;
      }
      if (subset == 7U &&
          (!execution_root_binding(root, identity, execution) ||
           !equal_bytes(execution->root_binding, expected_root, 32U)))
          return 0;
      for (role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U)
        if ((subset & (1U << role)) != 0U) {
          if (!verify_retained_object(root, &execution->root,
                                      "op.windows-execution-root-object/v1", 0U,
                                      execution->root.binding) ||
              !verify_retained_object(root, &execution->targets[role],
                                      "op.windows-execution-target/v1",
                                      (BYTE)role,
                                      execution->target_bindings[role]) ||
              !delete_retained_object(root, &execution->targets[role]))
            return 0;
        }
    } else {
      if (!execution_subset_census(root, &execution->root, &subset)) return 0;
      for (role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U)
        if ((subset & (1U << role)) != 0U) {
          if (!verify_retained_object(root, &execution->root,
                                      "op.windows-execution-root-object/v1", 0U,
                                      execution->root.binding) ||
              !delete_partial_target(root, execution, (BYTE)role))
            return 0;
        }
    }
    if (!verify_retained_object(root, &execution->root,
                                "op.windows-execution-root-object/v1", 0U,
                                execution->root.binding) ||
        !directory_empty(root, &execution->root) ||
        !delete_retained_object(root, &execution->root))
      return 0;
  }
  {
    if (!FlushFileBuffers(execution->parent.handle) ||
        !verify_retained_object(root, &execution->parent,
                                "op.windows-execution-parent/v1", 0U,
                                execution->parent.binding) ||
      GetFileAttributesW(execution->root.path) != INVALID_FILE_ATTRIBUTES ||
      (GetLastError() != ERROR_FILE_NOT_FOUND && GetLastError() != ERROR_PATH_NOT_FOUND) ||
      !root_snapshot(root, 0) ||
      !persist_execution_phase(root, identity, execution,
                               EXECUTION_ABSENCE_PROVED))
      return 0;
  }
  return 1;
}

static int release_execution(ROOT_CUSTODY *root, EXECUTION_CUSTODY *execution) {
  int clean = 1;
  DWORD role;
  for (role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U) {
    if (!release_retained_object(root, &execution->targets[role])) clean = 0;
    if (!release_retained_object(root, &execution->sources[role])) clean = 0;
  }
  if (!release_retained_object(root, &execution->root)) clean = 0;
  if (!release_retained_object(root, &execution->parent)) clean = 0;
  return clean;
}

static int identity_sid_text(ROOT_CUSTODY *root, PSID sid, PROFILE_IDENTITY *identity) {
  LPWSTR text = NULL;
  SIZE_T length;
  SIZE_T index;
  if (!IsValidSid(sid)) return 0;
  identity->sid_length = (WORD)GetLengthSid(sid);
  if (identity->sid_length < 8U || identity->sid_length > SID_MAX_BYTES) return 0;
  copy_bytes(identity->sid, sid, identity->sid_length);
  if (!ConvertSidToStringSidW(sid, &text)) return 0;
  length = wide_length(text);
  if (length < 3U || length > SID_TEXT_MAX_BYTES || text[0] != L'S' || text[1] != L'-') {
    if (LocalFree(text) != NULL) root->resource_ambiguous = 1;
    return 0;
  }
  for (index = 0; index < length; index += 1U) {
    if (text[index] > 127U) {
      if (LocalFree(text) != NULL) root->resource_ambiguous = 1;
      return 0;
    }
    identity->sid_text[index] = (CHAR)text[index];
  }
  identity->sid_text[length] = '\0';
  identity->sid_text_length = (WORD)length;
  if (LocalFree(text) != NULL) root->resource_ambiguous = 1;
  return 1;
}

static int derive_folder(PROFILE_IDENTITY *identity) {
  WCHAR sid_text[SID_TEXT_MAX_BYTES + 1U];
  PWSTR ordinary = NULL;
  SIZE_T ordinary_units;
  SIZE_T index;
  for (index = 0; index < identity->sid_text_length; index += 1U)
    sid_text[index] = (WCHAR)(BYTE)identity->sid_text[index];
  sid_text[identity->sid_text_length] = L'\0';
  if (FAILED(GetAppContainerFolderPath(sid_text, &ordinary)) || ordinary == NULL) return 0;
  ordinary_units = wide_length(ordinary);
  if (ordinary_units < 3U || ordinary[1] != L':' || ordinary[2] != L'\\' ||
      ordinary_units + 4U > PATH_MAX_UNITS) {
    CoTaskMemFree(ordinary);
    return 0;
  }
  identity->folder[0] = L'\\'; identity->folder[1] = L'\\';
  identity->folder[2] = L'?'; identity->folder[3] = L'\\';
  copy_bytes(identity->folder + 4U, ordinary, (ordinary_units + 1U) * 2U);
  identity->folder_units = (WORD)(ordinary_units + 4U);
  CoTaskMemFree(ordinary);
  return 1;
}

static int generate_identity(ROOT_CUSTODY *root, PROFILE_IDENTITY *identity) {
  static const WCHAR digits[] = L"0123456789abcdef";
  PSID derived = NULL;
  DWORD index;
  zero_bytes(identity, sizeof(*identity));
  if (BCryptGenRandom(NULL, identity->token, TOKEN_BYTES, BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0) {
    return 0;
  }
  identity->moniker[0] = L'o'; identity->moniker[1] = L'r'; identity->moniker[2] = L'c';
  identity->moniker[3] = L'h'; identity->moniker[4] = L'6'; identity->moniker[5] = L'-';
  for (index = 0; index < 29U; index += 1U) {
    identity->moniker[6U + index * 2U] = digits[identity->token[index] >> 4U];
    identity->moniker[7U + index * 2U] = digits[identity->token[index] & 15U];
  }
  identity->moniker[64] = L'\0';
  if (FAILED(DeriveAppContainerSidFromAppContainerName(identity->moniker, &derived)) ||
      derived == NULL) {
    if (derived != NULL && FreeSid(derived) != NULL) root->resource_ambiguous = 1;
    return 0;
  }
  if (!identity_sid_text(root, derived, identity)) {
    if (FreeSid(derived) != NULL) root->resource_ambiguous = 1;
    return 0;
  }
  if (FreeSid(derived) != NULL) root->resource_ambiguous = 1;
  return !root->resource_ambiguous;
}

static int identity_for_token(ROOT_CUSTODY *root, const BYTE token[32],
                              PROFILE_IDENTITY *identity) {
  static const WCHAR digits[] = L"0123456789abcdef";
  PSID derived = NULL;
  DWORD index;
  zero_bytes(identity, sizeof(*identity));
  copy_bytes(identity->token, token, 32U);
  identity->moniker[0] = L'o'; identity->moniker[1] = L'r'; identity->moniker[2] = L'c';
  identity->moniker[3] = L'h'; identity->moniker[4] = L'6'; identity->moniker[5] = L'-';
  for (index = 0; index < 29U; index += 1U) {
    identity->moniker[6U + index * 2U] = digits[token[index] >> 4U];
    identity->moniker[7U + index * 2U] = digits[token[index] & 15U];
  }
  identity->moniker[64] = L'\0';
  if (FAILED(DeriveAppContainerSidFromAppContainerName(identity->moniker, &derived)) ||
      derived == NULL || !identity_sid_text(root, derived, identity)) {
    if (derived != NULL && FreeSid(derived) != NULL) root->resource_ambiguous = 1;
    return 0;
  }
  if (FreeSid(derived) != NULL) root->resource_ambiguous = 1;
  return !root->resource_ambiguous;
}

static int hex_value(WCHAR value, BYTE *digit) {
  if (value >= L'0' && value <= L'9') { *digit = (BYTE)(value - L'0'); return 1; }
  if (value >= L'a' && value <= L'f') { *digit = (BYTE)(value - L'a' + 10U); return 1; }
  return 0;
}

static int parse_journal_filename(const WCHAR *name, BYTE token[32], BYTE *kind, int *pending) {
  static const WCHAR prefix[] = L"windows-profile-";
  static const WCHAR *suffix[] = {
    L"", L"-00-used.opwj", L"-01-profile-attempted.opwj", L"-02-profile-created.opwj",
    L"-03-profile-delete-attempted.opwj", L"-04-profile-absence-proved.opwj"
  };
  DWORD index;
  const WCHAR *tail;
  for (index = 0; index < 16U; index += 1U) if (name[index] != prefix[index]) return 0;
  for (index = 0; index < 32U; index += 1U) {
    BYTE high;
    BYTE low;
    if (!hex_value(name[16U + index * 2U], &high) ||
        !hex_value(name[17U + index * 2U], &low))
      return 0;
    token[index] = (BYTE)((high << 4U) | low);
  }
  tail = name + 80U;
  for (*kind = JOURNAL_USED; *kind <= JOURNAL_PROFILE_ABSENCE_PROVED; *kind += 1U) {
    DWORD suffix_units = (DWORD)wide_length(suffix[*kind]);
    DWORD tail_units = (DWORD)wide_length(tail);
    if (tail_units == suffix_units && wide_equal(tail, suffix[*kind])) { *pending = 0; return 1; }
    if (tail_units == suffix_units + 8U) {
      DWORD match = 1U;
      static const WCHAR pending_suffix[] = L".pending";
      for (index = 0; index < suffix_units; index += 1U)
        if (tail[index] != suffix[*kind][index]) match = 0U;
      if (match && wide_equal(tail + suffix_units, pending_suffix)) { *pending = 1; return 1; }
    }
  }
  return 0;
}

static int parse_execution_journal_filename(const WCHAR *name, BYTE token[32],
                                            BYTE *kind, int *pending) {
  static const WCHAR prefix[] = L"windows-execution-";
  static const WCHAR *suffix[] = {
    L"", L"-00-attempted.opwx", L"-01-created.opwx",
    L"-02-delete-attempted.opwx", L"-03-absence-proved.opwx"
  };
  DWORD index;
  const WCHAR *tail;
  for (index = 0U; index < 18U; index += 1U)
    if (name[index] != prefix[index]) return 0;
  for (index = 0U; index < 32U; index += 1U) {
    BYTE high;
    BYTE low;
    if (!hex_value(name[18U + index * 2U], &high) ||
        !hex_value(name[19U + index * 2U], &low))
      return 0;
    token[index] = (BYTE)((high << 4U) | low);
  }
  tail = name + 82U;
  for (*kind = EXECUTION_ATTEMPTED; *kind <= EXECUTION_ABSENCE_PROVED;
       *kind += 1U) {
    DWORD suffix_units = (DWORD)wide_length(suffix[*kind]);
    DWORD tail_units = (DWORD)wide_length(tail);
    if (tail_units == suffix_units && wide_equal(tail, suffix[*kind])) {
      *pending = 0;
      return 1;
    }
    if (tail_units == suffix_units + 8U) {
      DWORD match = 1U;
      static const WCHAR pending_suffix[] = L".pending";
      for (index = 0U; index < suffix_units; index += 1U)
        if (tail[index] != suffix[*kind][index]) match = 0U;
      if (match && wide_equal(tail + suffix_units, pending_suffix)) {
        *pending = 1;
        return 1;
      }
    }
  }
  return 0;
}

static int secure_record_handle(HANDLE file, ROOT_CUSTODY *root) {
  PSID owner = NULL;
  PACL dacl = NULL;
  PACL sacl = NULL;
  PSECURITY_DESCRIPTOR security = NULL;
  SECURITY_DESCRIPTOR_CONTROL control;
  DWORD revision;
  DWORD result = GetSecurityInfo(file, SE_FILE_OBJECT,
                                 OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION |
                                 LABEL_SECURITY_INFORMATION,
                                 &owner, NULL, &dacl, &sacl, &security);
  int valid = result == ERROR_SUCCESS && security != NULL && owner != NULL &&
              EqualSid(owner, root->stable_sid) &&
              GetSecurityDescriptorControl(security, &control, &revision) &&
              (control & SE_DACL_PROTECTED) != 0U &&
              exact_acl(root, dacl, root->stable_sid, root->integrity_sid, 0) &&
              exact_acl(root, sacl, root->stable_sid, root->integrity_sid, 1);
  if (security != NULL && LocalFree(security) != NULL) root->resource_ambiguous = 1;
  return valid;
}

static int load_record(ROOT_CUSTODY *root, const WCHAR *path, BYTE **bytes, DWORD *length) {
  HANDLE file = CreateFileW(path, GENERIC_READ | READ_CONTROL, 0U, NULL, OPEN_EXISTING,
                            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN, NULL);
  BY_HANDLE_FILE_INFORMATION information;
  DWORD read = 0;
  if (file == INVALID_HANDLE_VALUE || !GetFileInformationByHandle(file, &information) ||
      information.nNumberOfLinks != 1U ||
      (information.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0U ||
      information.nFileSizeHigh != 0U || information.nFileSizeLow < 12U ||
      information.nFileSizeLow > 4096U || !secure_record_handle(file, root)) {
    if (file != INVALID_HANDLE_VALUE && !CloseHandle(file)) root->resource_ambiguous = 1;
    return 0;
  }
  *length = information.nFileSizeLow;
  *bytes = (BYTE *)HeapAlloc(GetProcessHeap(), 0U, *length);
  if (*bytes == NULL || !ReadFile(file, *bytes, *length, &read, NULL) || read != *length) {
    if (!CloseHandle(file)) root->resource_ambiguous = 1;
    if (*bytes != NULL && !HeapFree(GetProcessHeap(), 0U, *bytes)) root->resource_ambiguous = 1;
    *bytes = NULL;
    return 0;
  }
  if (!CloseHandle(file)) root->resource_ambiguous = 1;
  return !root->resource_ambiguous;
}

static int parse_record(ROOT_CUSTODY *root, JOURNAL_GROUP *group, BYTE kind) {
  WCHAR path[1200];
  BYTE *record = NULL;
  DWORD length = 0;
  DWORD cursor = 12U;
  WORD sid_length;
  WORD sid_text_length;
  WORD folder_units;
  DWORD index;
  BYTE digest[32];
  PROFILE_IDENTITY expected;
  if (!journal_path(root, group->identity.token, kind, 0, path) ||
      !load_record(root, path, &record, &length))
    return 0;
  if (record[0] != 'O' || record[1] != 'P' || record[2] != 'W' || record[3] != 'J' ||
      record[4] != 1U || record[5] != kind || record[6] != 0U || record[7] != 0U ||
      read_u32(record + 8U) != length || length < 180U ||
      !equal_bytes(record + cursor, group->identity.token, 32U))
    goto failed;
  cursor += 32U;
  if ((kind == JOURNAL_USED && !equal_bytes(record + cursor, (BYTE[32]){0}, 32U)) ||
      (kind != JOURNAL_USED && !equal_bytes(record + cursor, group->identity.prior_digest, 32U)))
    goto failed;
  cursor += 32U;
  if (!equal_bytes(record + cursor, root->digest, 32U)) goto failed;
  cursor += 32U;
  if (!identity_for_token(root, group->identity.token, &expected)) goto failed;
  for (index = 0; index < 64U; index += 1U)
    if (record[cursor + index] != (BYTE)expected.moniker[index]) goto failed;
  cursor += 64U;
  if (cursor + 2U > length) goto failed;
  sid_length = read_u16(record + cursor); cursor += 2U;
  if (sid_length != expected.sid_length || cursor + sid_length + 2U > length ||
      !equal_bytes(record + cursor, expected.sid, sid_length))
    goto failed;
  cursor += sid_length;
  sid_text_length = read_u16(record + cursor); cursor += 2U;
  if (sid_text_length != expected.sid_text_length || cursor + sid_text_length + 2U > length ||
      !equal_bytes(record + cursor, expected.sid_text, sid_text_length))
    goto failed;
  cursor += sid_text_length;
  folder_units = read_u16(record + cursor); cursor += 2U;
  if (cursor + (DWORD)folder_units * 2U > length) goto failed;
  if (kind <= JOURNAL_PROFILE_ATTEMPTED) {
    if (folder_units != 0U) goto failed;
  } else {
    WCHAR observed_folder[PATH_MAX_UNITS + 1U];
    if (folder_units == 0U || folder_units > PATH_MAX_UNITS) goto failed;
    copy_bytes(observed_folder, record + cursor, (DWORD)folder_units * 2U);
    observed_folder[folder_units] = L'\0';
    if (!canonical_folder_path(observed_folder, folder_units)) goto failed;
    if (kind == JOURNAL_PROFILE_CREATED) {
      copy_bytes(group->identity.folder, observed_folder, ((DWORD)folder_units + 1U) * 2U);
      group->identity.folder_units = folder_units;
    } else if (folder_units != group->identity.folder_units ||
               !equal_bytes(observed_folder, group->identity.folder, (DWORD)folder_units * 2U)) {
      goto failed;
    }
  }
  cursor += (DWORD)folder_units * 2U;
  if (kind >= JOURNAL_PROFILE_CREATED) {
    if (cursor + 32U != length) goto failed;
    if (kind == JOURNAL_PROFILE_CREATED)
      copy_bytes(group->identity.folder_binding, record + cursor, 32U);
    else if (!equal_bytes(group->identity.folder_binding, record + cursor, 32U))
      goto failed;
    cursor += 32U;
  }
  if (cursor != length || !sha256(record, length, digest, &root->resource_ambiguous)) goto failed;
  copy_bytes(group->identity.moniker, expected.moniker, sizeof(expected.moniker));
  copy_bytes(group->identity.sid, expected.sid, expected.sid_length);
  group->identity.sid_length = expected.sid_length;
  copy_bytes(group->identity.sid_text, expected.sid_text, expected.sid_text_length + 1U);
  group->identity.sid_text_length = expected.sid_text_length;
  if (kind <= JOURNAL_PROFILE_ATTEMPTED) {
    group->identity.folder[0] = L'\0';
    group->identity.folder_units = 0U;
  }
  copy_bytes(group->identity.prior_digest, digest, 32U);
  if (kind == JOURNAL_PROFILE_CREATED)
    copy_bytes(group->profile_created_digest, digest, 32U);
  group->identity.phase = kind;
  if (!HeapFree(GetProcessHeap(), 0U, record)) root->resource_ambiguous = 1;
  return !root->resource_ambiguous;
failed:
  if (record != NULL && !HeapFree(GetProcessHeap(), 0U, record)) root->resource_ambiguous = 1;
  return 0;
}

static int parse_execution_record(ROOT_CUSTODY *root, JOURNAL_GROUP *group,
                                  BYTE kind) {
  WCHAR path[1200];
  BYTE *record = NULL;
  DWORD length = 0U;
  DWORD cursor = 12U;
  WORD parent_units;
  WORD root_units;
  BYTE digest[32];
  BYTE observed_parent_binding[32];
  BYTE observed_source_bindings[96];
  BYTE observed_root_binding[32];
  BYTE observed_target_bindings[96];
  WCHAR observed_parent[PATH_MAX_UNITS + 1U];
  WCHAR observed_root[PATH_MAX_UNITS + 1U];
  WCHAR expected_root[PATH_MAX_UNITS + 1U];
  int partial;
  int complete;
  EXECUTION_CUSTODY *execution = group->execution;
  if (kind == EXECUTION_ATTEMPTED) {
    if (execution != NULL) return 0;
    execution = (EXECUTION_CUSTODY *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY,
                                               sizeof(EXECUTION_CUSTODY));
    if (execution == NULL) return 0;
    group->execution = execution;
  } else if (execution == NULL) {
    return 0;
  }
  if (!execution_journal_path(root, group->identity.token, kind, 0, path) ||
      !load_record(root, path, &record, &length))
    return 0;
  if (length < 348U || record[0] != 'O' || record[1] != 'P' ||
      record[2] != 'W' || record[3] != 'X' || record[4] != 1U ||
      record[5] != kind || record[6] != 0U || record[7] != 0U ||
      read_u32(record + 8U) != length ||
      !equal_bytes(record + cursor, group->identity.token, 32U))
    goto failed;
  cursor += 32U;
  if ((kind == EXECUTION_ATTEMPTED &&
       !equal_bytes(record + cursor, (BYTE[32]){0}, 32U)) ||
      (kind != EXECUTION_ATTEMPTED &&
       !equal_bytes(record + cursor, execution->prior_digest, 32U)))
    goto failed;
  cursor += 32U;
  if (!equal_bytes(record + cursor, root->digest, 32U)) goto failed;
  cursor += 32U;
  if (!equal_bytes(record + cursor, group->profile_created_digest, 32U)) goto failed;
  cursor += 32U;
  if (cursor + 2U > length) goto failed;
  parent_units = read_u16(record + cursor); cursor += 2U;
  if (parent_units == 0U || parent_units > PATH_MAX_UNITS ||
      cursor + (DWORD)parent_units * 2U + 34U > length)
    goto failed;
  copy_bytes(observed_parent, record + cursor, (DWORD)parent_units * 2U);
  observed_parent[parent_units] = L'\0';
  if (!canonical_folder_path(observed_parent, parent_units)) goto failed;
  cursor += (DWORD)parent_units * 2U;
  copy_bytes(observed_parent_binding, record + cursor, 32U); cursor += 32U;
  root_units = read_u16(record + cursor); cursor += 2U;
  if (root_units == 0U || root_units > PATH_MAX_UNITS ||
      cursor + (DWORD)root_units * 2U + 224U != length)
    goto failed;
  copy_bytes(observed_root, record + cursor, (DWORD)root_units * 2U);
  observed_root[root_units] = L'\0';
  {
    WCHAR hex[65];
    DWORD expected_cursor = 0U;
    hex_token(group->identity.token, hex);
    if (!canonical_folder_path(observed_root, root_units) ||
        !append_wide(expected_root, PATH_MAX_UNITS + 1U, &expected_cursor,
                     observed_parent) ||
        !append_wide(expected_root, PATH_MAX_UNITS + 1U, &expected_cursor,
                     L"\\orch6-execution-") ||
        !append_wide(expected_root, PATH_MAX_UNITS + 1U, &expected_cursor, hex) ||
        expected_cursor != root_units || !wide_equal(expected_root, observed_root))
      goto failed;
  }
  cursor += (DWORD)root_units * 2U;
  copy_bytes(observed_source_bindings, record + cursor, 96U); cursor += 96U;
  copy_bytes(observed_root_binding, record + cursor, 32U); cursor += 32U;
  copy_bytes(observed_target_bindings, record + cursor, 96U); cursor += 96U;
  partial = equal_bytes(observed_root_binding, (BYTE[32]){0}, 32U) &&
            equal_bytes(observed_target_bindings, (BYTE[96]){0}, 96U);
  complete = !equal_bytes(observed_root_binding, (BYTE[32]){0}, 32U);
  for (DWORD role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U)
    if (equal_bytes(observed_target_bindings + role * 32U,
                    (BYTE[32]){0}, 32U))
      complete = 0;
  if (cursor != length ||
      equal_bytes(observed_parent_binding, (BYTE[32]){0}, 32U))
    goto failed;
  for (DWORD role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U)
    if (equal_bytes(observed_source_bindings + role * 32U,
                    (BYTE[32]){0}, 32U))
      goto failed;
  if (kind == EXECUTION_ATTEMPTED) {
    if (execution->phase != 0U || !partial) goto failed;
    execution->parent.path_units = parent_units;
    copy_bytes(execution->parent.path, observed_parent,
               ((DWORD)parent_units + 1U) * 2U);
    copy_bytes(execution->parent.binding, observed_parent_binding, 32U);
    execution->root.path_units = root_units;
    copy_bytes(execution->root.path, observed_root,
               ((DWORD)root_units + 1U) * 2U);
    copy_bytes(execution->source_bindings, observed_source_bindings, 96U);
    copy_bytes(execution->profile_created_digest, group->profile_created_digest, 32U);
    execution->parent.handle = INVALID_HANDLE_VALUE;
    execution->root.handle = INVALID_HANDLE_VALUE;
    for (DWORD role = 0U; role < EXECUTION_ROLE_COUNT; role += 1U) {
      execution->sources[role].handle = INVALID_HANDLE_VALUE;
      execution->targets[role].handle = INVALID_HANDLE_VALUE;
    }
  } else {
    if (parent_units != execution->parent.path_units ||
        root_units != execution->root.path_units ||
        !equal_bytes(observed_parent, execution->parent.path,
                     (DWORD)parent_units * 2U) ||
        !equal_bytes(observed_root, execution->root.path,
                     (DWORD)root_units * 2U) ||
        !equal_bytes(observed_parent_binding, execution->parent.binding, 32U) ||
        !equal_bytes(observed_source_bindings, execution->source_bindings, 96U))
      goto failed;
    if (kind == EXECUTION_CREATED) {
      if (execution->phase != EXECUTION_ATTEMPTED || !complete) goto failed;
      copy_bytes(execution->root_binding, observed_root_binding, 32U);
      copy_bytes(execution->target_bindings, observed_target_bindings, 96U);
    } else if (kind == EXECUTION_DELETE_ATTEMPTED) {
      if (!((execution->phase == EXECUTION_ATTEMPTED && partial) ||
            (execution->phase == EXECUTION_CREATED && complete)))
        goto failed;
      if (execution->phase == EXECUTION_CREATED &&
          (!equal_bytes(observed_root_binding, execution->root_binding, 32U) ||
           !equal_bytes(observed_target_bindings,
                        execution->target_bindings, 96U)))
        goto failed;
    } else {
      int existing_partial = equal_bytes(execution->root_binding,
                                         (BYTE[32]){0}, 32U);
      if (execution->phase != EXECUTION_DELETE_ATTEMPTED ||
          (existing_partial != partial) ||
          !equal_bytes(observed_root_binding, execution->root_binding, 32U) ||
          !equal_bytes(observed_target_bindings, execution->target_bindings, 96U))
        goto failed;
    }
  }
  if (!sha256(record, length, digest, &root->resource_ambiguous)) goto failed;
  copy_bytes(execution->prior_digest, digest, 32U);
  execution->phase = kind;
  if (!HeapFree(GetProcessHeap(), 0U, record)) root->resource_ambiguous = 1;
  return !root->resource_ambiguous;
failed:
  if (record != NULL && !HeapFree(GetProcessHeap(), 0U, record))
    root->resource_ambiguous = 1;
  return 0;
}

static LONG compare_token(const BYTE left[32], const BYTE right[32]) {
  DWORD index;
  for (index = 0; index < 32U; index += 1U) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

static int scan_journals(ROOT_CUSTODY *root, JOURNAL_GROUP **groups_output, DWORD *count_output) {
  WCHAR pattern[1200];
  DWORD cursor = 0;
  HANDLE find;
  WIN32_FIND_DATAW data;
  JOURNAL_GROUP *groups = (JOURNAL_GROUP *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY,
                                                    sizeof(JOURNAL_GROUP) * CENSUS_MAXIMUM);
  DWORD count = 0;
  int more;
  if (groups == NULL || !append_wide(pattern, 1200U, &cursor, root->path) ||
      !append_wide(pattern, 1200U, &cursor, L"\\*"))
    goto failed;
  find = FindFirstFileW(pattern, &data);
  if (find == INVALID_HANDLE_VALUE && GetLastError() != ERROR_FILE_NOT_FOUND) goto failed;
  more = find == INVALID_HANDLE_VALUE ? 0 : 1;
  while (more) {
    BYTE token[32];
    BYTE kind;
    int pending;
    int execution_file = 0;
    DWORD group_index;
    if (!wide_equal(data.cFileName, L".") && !wide_equal(data.cFileName, L"..")) {
      if ((data.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0U ||
          (!parse_journal_filename(data.cFileName, token, &kind, &pending) &&
           !(execution_file = parse_execution_journal_filename(
               data.cFileName, token, &kind, &pending)))) {
        if (!FindClose(find)) root->resource_ambiguous = 1;
        goto failed;
      }
      for (group_index = 0; group_index < count; group_index += 1U)
        if (compare_token(groups[group_index].identity.token, token) == 0) break;
      if (group_index == count) {
        if (count == CENSUS_MAXIMUM) {
          if (!FindClose(find)) root->resource_ambiguous = 1;
          goto failed;
        }
        copy_bytes(groups[count].identity.token, token, 32U);
        count += 1U;
      }
      if ((pending && (execution_file ? groups[group_index].execution_pending_seen[kind] :
                                        groups[group_index].pending_seen[kind])) ||
          (!pending && (execution_file ? groups[group_index].execution_final_seen[kind] :
                                         groups[group_index].final_seen[kind]))) {
        if (!FindClose(find)) root->resource_ambiguous = 1;
        goto failed;
      }
      if (execution_file) {
        if (pending) groups[group_index].execution_pending_seen[kind] = 1U;
        else groups[group_index].execution_final_seen[kind] = 1U;
      } else {
        if (pending) groups[group_index].pending_seen[kind] = 1U;
        else groups[group_index].final_seen[kind] = 1U;
      }
    }
    more = FindNextFileW(find, &data);
    if (!more && GetLastError() != ERROR_NO_MORE_FILES) {
      if (!FindClose(find)) root->resource_ambiguous = 1;
      goto failed;
    }
  }
  if (find != INVALID_HANDLE_VALUE && !FindClose(find)) {
    root->resource_ambiguous = 1;
    goto failed;
  }
  for (DWORD index = 1U; index < count; index += 1U) {
    JOURNAL_GROUP moving;
    DWORD place = index;
    copy_bytes(&moving, &groups[index], sizeof(moving));
    while (place > 0U && compare_token(groups[place - 1U].identity.token, moving.identity.token) > 0) {
      copy_bytes(&groups[place], &groups[place - 1U], sizeof(groups[place]));
      place -= 1U;
    }
    copy_bytes(&groups[place], &moving, sizeof(groups[place]));
  }
  for (DWORD group_index = 0; group_index < count; group_index += 1U) {
    JOURNAL_GROUP *group = &groups[group_index];
    if (!group->final_seen[JOURNAL_USED]) {
      if (!group->pending_seen[JOURNAL_USED] ||
          !identity_for_token(root, group->identity.token, &group->identity))
        goto failed;
      for (BYTE kind = JOURNAL_PROFILE_ATTEMPTED;
           kind <= JOURNAL_PROFILE_ABSENCE_PROVED; kind += 1U)
        if (group->final_seen[kind] || group->pending_seen[kind]) goto failed;
    } else {
      for (BYTE kind = JOURNAL_USED; kind <= JOURNAL_PROFILE_ABSENCE_PROVED; kind += 1U) {
        if (group->final_seen[kind] && !parse_record(root, group, kind)) goto failed;
        if (!group->final_seen[kind]) {
          for (BYTE later = (BYTE)(kind + 1U); later <= JOURNAL_PROFILE_ABSENCE_PROVED; later += 1U)
            if (group->final_seen[later]) goto failed;
          break;
        }
      }
    }
    for (BYTE kind = JOURNAL_USED; kind <= JOURNAL_PROFILE_ABSENCE_PROVED; kind += 1U) {
      if (group->pending_seen[kind]) {
        WCHAR path[1200];
        HANDLE file;
        BY_HANDLE_FILE_INFORMATION information;
        if ((!group->final_seen[JOURNAL_USED] && kind != JOURNAL_USED) ||
            !journal_path(root, group->identity.token, kind, 1, path))
          goto failed;
        file = CreateFileW(path, GENERIC_READ | READ_CONTROL, 0U, NULL, OPEN_EXISTING,
                           FILE_FLAG_OPEN_REPARSE_POINT, NULL);
        if (file == INVALID_HANDLE_VALUE) goto failed;
        if (!GetFileInformationByHandle(file, &information) || information.nNumberOfLinks != 1U ||
            (information.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0U ||
            !secure_record_handle(file, root)) {
          if (!CloseHandle(file)) root->resource_ambiguous = 1;
          goto failed;
        }
        if (!CloseHandle(file)) goto failed;
      }
    }
    if (group->execution_final_seen[EXECUTION_ATTEMPTED]) {
      if (!group->final_seen[JOURNAL_PROFILE_CREATED]) goto failed;
      if (!parse_execution_record(root, group, EXECUTION_ATTEMPTED)) goto failed;
      if (group->execution_final_seen[EXECUTION_CREATED] &&
          !parse_execution_record(root, group, EXECUTION_CREATED))
        goto failed;
      if (group->execution_final_seen[EXECUTION_DELETE_ATTEMPTED] &&
          !parse_execution_record(root, group, EXECUTION_DELETE_ATTEMPTED))
        goto failed;
      if (group->execution_final_seen[EXECUTION_ABSENCE_PROVED]) {
        if (!group->execution_final_seen[EXECUTION_DELETE_ATTEMPTED] ||
            !parse_execution_record(root, group, EXECUTION_ABSENCE_PROVED))
          goto failed;
      }
    } else {
      for (BYTE kind = EXECUTION_CREATED; kind <= EXECUTION_ABSENCE_PROVED;
           kind += 1U)
        if (group->execution_final_seen[kind]) goto failed;
    }
    for (BYTE kind = EXECUTION_ATTEMPTED; kind <= EXECUTION_ABSENCE_PROVED;
         kind += 1U) {
      if (group->execution_pending_seen[kind]) {
        WCHAR path[1200];
        HANDLE file;
        BY_HANDLE_FILE_INFORMATION information;
        if (!group->final_seen[JOURNAL_PROFILE_CREATED] ||
            !execution_journal_path(root, group->identity.token, kind, 1, path))
          goto failed;
        file = CreateFileW(path, GENERIC_READ | READ_CONTROL, 0U, NULL,
                           OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, NULL);
        if (file == INVALID_HANDLE_VALUE) goto failed;
        if (!GetFileInformationByHandle(file, &information) ||
            information.nNumberOfLinks != 1U ||
            (information.dwFileAttributes &
             (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0U ||
            !secure_record_handle(file, root)) {
          if (!CloseHandle(file)) root->resource_ambiguous = 1;
          goto failed;
        }
        if (!CloseHandle(file)) goto failed;
      }
    }
    if (group->identity.phase >= JOURNAL_PROFILE_DELETE_ATTEMPTED &&
        group->execution != NULL &&
        group->execution->phase != EXECUTION_ABSENCE_PROVED)
      goto failed;
  }
  if (!root_snapshot(root, 0)) goto failed;
  *groups_output = groups;
  *count_output = count;
  return 1;
failed:
  if (groups != NULL) {
    for (DWORD index = 0U; index < count; index += 1U)
      if (groups[index].execution != NULL) {
        if (!HeapFree(GetProcessHeap(), 0U, groups[index].execution))
          root->resource_ambiguous = 1;
        groups[index].execution = NULL;
      }
  }
  if (groups != NULL && !HeapFree(GetProcessHeap(), 0U, groups)) root->resource_ambiguous = 1;
  return -1;
}

static int census_profile(const ROOT_CUSTODY *root, const PROFILE_IDENTITY *identity,
                          int absent, int zero_capabilities) {
  PINET_FIREWALL_APP_CONTAINER rows = NULL;
  DWORD count = 0;
  DWORD index;
  DWORD matches = 0;
  int valid = 1;
  DWORD call_result = NetworkIsolationEnumAppContainers(NETISO_FLAG_FORCE_COMPUTE_BINARIES,
                                                        &count, &rows);
  if (call_result != ERROR_SUCCESS || count > CENSUS_MAXIMUM ||
      (count == 0U && rows != NULL) || (count != 0U && rows == NULL))
    valid = 0;
  for (index = 0; index < count && valid; index += 1U) {
    DWORD other;
    int name_match;
    int sid_match;
    SIZE_T name_units = 0;
    DWORD sid_length;
    if (rows[index].appContainerName == NULL || rows[index].appContainerSid == NULL ||
        !bounded_wide_length(rows[index].appContainerName, PATH_MAX_UNITS, &name_units) ||
        !IsValidSid(rows[index].appContainerSid)) {
      valid = 0; break;
    }
    sid_length = GetLengthSid(rows[index].appContainerSid);
    if (sid_length < 8U || sid_length > SID_MAX_BYTES ||
        rows[index].capabilities.count > CENSUS_MAXIMUM ||
        ((rows[index].capabilities.count == 0U) != (rows[index].capabilities.capabilities == NULL)) ||
        rows[index].binaries.count > CENSUS_MAXIMUM ||
        ((rows[index].binaries.count == 0U) != (rows[index].binaries.binaries == NULL))) {
      valid = 0; break;
    }
    name_match = wide_equal(rows[index].appContainerName, identity->moniker);
    sid_match = sid_length == identity->sid_length &&
                equal_bytes(rows[index].appContainerSid, identity->sid, identity->sid_length);
    if (name_match != sid_match) valid = 0;
    if (name_match && sid_match) {
      matches += 1U;
      if (rows[index].userSid == NULL || !IsValidSid(rows[index].userSid) ||
          GetLengthSid(rows[index].userSid) != root->stable_sid_length ||
          !EqualSid(rows[index].userSid, root->stable_sid) ||
          (zero_capabilities &&
           (rows[index].capabilities.count != 0U ||
            rows[index].capabilities.capabilities != NULL)))
        valid = 0;
    } else {
      for (other = 0; other < index; other += 1U) {
        int same_name = wide_equal(rows[index].appContainerName, rows[other].appContainerName);
        int same_sid = EqualSid(rows[index].appContainerSid, rows[other].appContainerSid);
        if (same_name != same_sid) {
          valid = 0; break;
        }
      }
    }
  }
  if (rows != NULL && NetworkIsolationFreeAppContainers(rows) != ERROR_SUCCESS) valid = 0;
  return valid && matches == (absent ? 0U : 1U);
}

static int complete_profile_census(const ROOT_CUSTODY *root,
                                   const JOURNAL_GROUP *groups, DWORD group_count) {
  PINET_FIREWALL_APP_CONTAINER rows = NULL;
  DWORD count = 0;
  DWORD index;
  int valid = 1;
  int owned_residue = 0;
  DWORD *raw_group_matches = NULL;
  DWORD call_result = NetworkIsolationEnumAppContainers(NETISO_FLAG_FORCE_COMPUTE_BINARIES,
                                                        &count, &rows);
  if (group_count != 0U)
    raw_group_matches = (DWORD *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY,
                                          (SIZE_T)group_count * sizeof(DWORD));
  if (call_result != ERROR_SUCCESS || count > CENSUS_MAXIMUM ||
      (count == 0U && rows != NULL) || (count != 0U && rows == NULL) ||
      (group_count != 0U && raw_group_matches == NULL))
    valid = 0;
  for (index = 0; index < count && valid; index += 1U) {
    DWORD other;
    SIZE_T name_units;
    int owned_name = 0;
    int owned_sid = 0;
    DWORD owner_index = 0;
    DWORD sid_owner_index = 0;
    DWORD sid_length;
    if (rows[index].appContainerName == NULL || rows[index].appContainerSid == NULL ||
        !bounded_wide_length(rows[index].appContainerName, PATH_MAX_UNITS, &name_units) ||
        !IsValidSid(rows[index].appContainerSid)) {
      valid = 0; break;
    }
    sid_length = GetLengthSid(rows[index].appContainerSid);
    if (sid_length < 8U || sid_length > SID_MAX_BYTES ||
        rows[index].capabilities.count > CENSUS_MAXIMUM ||
        ((rows[index].capabilities.count == 0U) != (rows[index].capabilities.capabilities == NULL)) ||
        rows[index].binaries.count > CENSUS_MAXIMUM ||
        ((rows[index].binaries.count == 0U) != (rows[index].binaries.binaries == NULL))) {
      valid = 0; break;
    }
    for (other = 0; other < group_count; other += 1U) {
      int name_match = wide_equal(rows[index].appContainerName, groups[other].identity.moniker);
      int sid_match = sid_length == groups[other].identity.sid_length &&
                      equal_bytes(rows[index].appContainerSid, groups[other].identity.sid,
                                  groups[other].identity.sid_length);
      if (name_match) { owned_name += 1; owner_index = other; }
      if (sid_match) { owned_sid += 1; sid_owner_index = other; }
    }
    if (owned_name != 0 || owned_sid != 0) {
      if (owned_name != 1 || owned_sid != 1 || owner_index != sid_owner_index ||
          groups[owner_index].identity.phase < JOURNAL_PROFILE_ATTEMPTED ||
          groups[owner_index].identity.phase == JOURNAL_PROFILE_ABSENCE_PROVED ||
          raw_group_matches[owner_index] != 0U ||
          rows[index].userSid == NULL || !IsValidSid(rows[index].userSid) ||
          GetLengthSid(rows[index].userSid) != root->stable_sid_length ||
          !EqualSid(rows[index].userSid, root->stable_sid) ||
          rows[index].capabilities.count != 0U || rows[index].capabilities.capabilities != NULL) {
        valid = 0;
        owned_residue = 1;
        break;
      }
      raw_group_matches[owner_index] += 1U;
    } else if (name_units >= 6U && rows[index].appContainerName[0] == L'o' &&
               rows[index].appContainerName[1] == L'r' && rows[index].appContainerName[2] == L'c' &&
               rows[index].appContainerName[3] == L'h' && rows[index].appContainerName[4] == L'6' &&
               rows[index].appContainerName[5] == L'-') {
      valid = 0;
      owned_residue = 1;
      break;
    } else {
      for (other = 0; other < index; other += 1U) {
        int same_name = wide_equal(rows[index].appContainerName, rows[other].appContainerName);
        int same_sid = EqualSid(rows[index].appContainerSid, rows[other].appContainerSid);
        if (same_name != same_sid) {
          valid = 0; break;
        }
      }
    }
  }
  if (rows != NULL && NetworkIsolationFreeAppContainers(rows) != ERROR_SUCCESS) valid = 0;
  if (raw_group_matches != NULL && !HeapFree(GetProcessHeap(), 0U, raw_group_matches)) valid = 0;
  return valid ? 1 : ((owned_residue || group_count != 0U) ? -1 : 0);
}

static int token_paths_absent(ROOT_CUSTODY *root, const BYTE token[32]) {
  WCHAR path[1200];
  BYTE kind;
  for (kind = JOURNAL_USED; kind <= JOURNAL_PROFILE_ABSENCE_PROVED; kind += 1U) {
    int pending;
    for (pending = 0; pending <= 1; pending += 1) {
      if (!journal_path(root, token, kind, pending, path)) return 0;
      if (GetFileAttributesW(path) != INVALID_FILE_ATTRIBUTES) return 0;
      if (GetLastError() != ERROR_FILE_NOT_FOUND && GetLastError() != ERROR_PATH_NOT_FOUND) return 0;
    }
  }
  return 1;
}

static int clear_pending(ROOT_CUSTODY *root, const PROFILE_IDENTITY *identity) {
  WCHAR path[1200];
  BYTE kind;
  for (kind = JOURNAL_USED; kind <= JOURNAL_PROFILE_ABSENCE_PROVED; kind += 1U) {
    HANDLE file;
    BY_HANDLE_FILE_INFORMATION information;
    FILE_DISPOSITION_INFO disposition;
    if (!journal_path(root, identity->token, kind, 1, path)) return 0;
    file = CreateFileW(path, DELETE | READ_CONTROL, 0U, NULL, OPEN_EXISTING,
                       FILE_FLAG_OPEN_REPARSE_POINT, NULL);
    if (file == INVALID_HANDLE_VALUE) {
      if (GetLastError() == ERROR_FILE_NOT_FOUND || GetLastError() == ERROR_PATH_NOT_FOUND) continue;
      return 0;
    }
    if (!GetFileInformationByHandle(file, &information) || information.nNumberOfLinks != 1U ||
        (information.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0U ||
        !secure_record_handle(file, root)) {
      if (!CloseHandle(file)) root->resource_ambiguous = 1;
      return 0;
    }
    disposition.DeleteFile = TRUE;
    if (!SetFileInformationByHandle(file, FileDispositionInfo, &disposition, sizeof(disposition)) ||
        !CloseHandle(file))
      return 0;
    if (GetFileAttributesW(path) != INVALID_FILE_ATTRIBUTES ||
        (GetLastError() != ERROR_FILE_NOT_FOUND && GetLastError() != ERROR_PATH_NOT_FOUND))
      return 0;
  }
  return FlushFileBuffers(root->handle) && root_snapshot(root, 0);
}

static int clear_execution_pending(ROOT_CUSTODY *root,
                                   const PROFILE_IDENTITY *identity) {
  WCHAR path[1200];
  BYTE kind;
  for (kind = EXECUTION_ATTEMPTED; kind <= EXECUTION_ABSENCE_PROVED; kind += 1U) {
    HANDLE file;
    BY_HANDLE_FILE_INFORMATION information;
    FILE_DISPOSITION_INFO disposition;
    if (!execution_journal_path(root, identity->token, kind, 1, path)) return 0;
    file = CreateFileW(path, DELETE | READ_CONTROL, 0U, NULL, OPEN_EXISTING,
                       FILE_FLAG_OPEN_REPARSE_POINT, NULL);
    if (file == INVALID_HANDLE_VALUE) {
      if (GetLastError() == ERROR_FILE_NOT_FOUND || GetLastError() == ERROR_PATH_NOT_FOUND)
        continue;
      return 0;
    }
    if (!GetFileInformationByHandle(file, &information) ||
        information.nNumberOfLinks != 1U ||
        (information.dwFileAttributes &
         (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0U ||
        !secure_record_handle(file, root)) {
      if (!CloseHandle(file)) root->resource_ambiguous = 1;
      return 0;
    }
    disposition.DeleteFile = TRUE;
    if (!SetFileInformationByHandle(file, FileDispositionInfo, &disposition,
                                    sizeof(disposition)) || !CloseHandle(file) ||
        GetFileAttributesW(path) != INVALID_FILE_ATTRIBUTES ||
        (GetLastError() != ERROR_FILE_NOT_FOUND && GetLastError() != ERROR_PATH_NOT_FOUND))
      return 0;
  }
  return FlushFileBuffers(root->handle) && root_snapshot(root, 0);
}

static int folder_absent(const PROFILE_IDENTITY *identity) {
  HANDLE handle = CreateFileW(identity->folder, FILE_READ_ATTRIBUTES, FILE_SHARE_READ, NULL,
                              OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS |
                              FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  DWORD error;
  if (handle != INVALID_HANDLE_VALUE) {
    if (!CloseHandle(handle)) return 0;
    return 0;
  }
  error = GetLastError();
  return error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND;
}

static int exact_profile_folder_security(ROOT_CUSTODY *root, PROFILE_IDENTITY *identity,
                                         HANDLE folder, PSECURITY_DESCRIPTOR *security_output,
                                         DWORD *security_length) {
  PSID owner = NULL;
  PACL dacl = NULL;
  PACL sacl = NULL;
  PSECURITY_DESCRIPTOR security = NULL;
  SECURITY_DESCRIPTOR_CONTROL control;
  DWORD revision;
  ACL_SIZE_INFORMATION dacl_information;
  ACL_SIZE_INFORMATION sacl_information;
  SID_IDENTIFIER_AUTHORITY nt_authority = SECURITY_NT_AUTHORITY;
  SID_IDENTIFIER_AUTHORITY label_authority = SECURITY_MANDATORY_LABEL_AUTHORITY;
  PSID system_sid = NULL;
  PSID administrators_sid = NULL;
  PSID low_sid = NULL;
  DWORD package_aces = 0U;
  DWORD index;
  int valid = 0;
  DWORD dangerous = FILE_WRITE_DATA | FILE_APPEND_DATA | FILE_WRITE_EA | FILE_DELETE_CHILD |
                    FILE_WRITE_ATTRIBUTES | DELETE | WRITE_DAC | WRITE_OWNER |
                    GENERIC_WRITE | GENERIC_ALL;
  if (GetSecurityInfo(folder, SE_FILE_OBJECT,
                      OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION |
                      LABEL_SECURITY_INFORMATION,
                      &owner, NULL, &dacl, &sacl, &security) != ERROR_SUCCESS || security == NULL ||
      owner == NULL || dacl == NULL || sacl == NULL || !EqualSid(owner, root->stable_sid) ||
      !GetSecurityDescriptorControl(security, &control, &revision) ||
      (control & SE_DACL_PROTECTED) != 0U ||
      !GetAclInformation(dacl, &dacl_information, sizeof(dacl_information), AclSizeInformation) ||
      dacl_information.AceCount == 0U || dacl_information.AceCount > 64U ||
      !GetAclInformation(sacl, &sacl_information, sizeof(sacl_information), AclSizeInformation) ||
      sacl_information.AceCount != 1U ||
      !AllocateAndInitializeSid(&nt_authority, 1U, SECURITY_LOCAL_SYSTEM_RID,
                                0U, 0U, 0U, 0U, 0U, 0U, 0U, &system_sid) ||
      !AllocateAndInitializeSid(&nt_authority, 2U, SECURITY_BUILTIN_DOMAIN_RID,
                                DOMAIN_ALIAS_RID_ADMINS, 0U, 0U, 0U, 0U, 0U, 0U,
                                &administrators_sid) ||
      !AllocateAndInitializeSid(&label_authority, 1U, SECURITY_MANDATORY_LOW_RID,
                                0U, 0U, 0U, 0U, 0U, 0U, 0U, &low_sid))
    goto done;
  for (index = 0; index < dacl_information.AceCount; index += 1U) {
    void *raw = NULL;
    ACE_HEADER *header;
    ACCESS_ALLOWED_ACE *ace;
    PSID sid;
    if (!GetAce(dacl, index, &raw)) goto done;
    header = (ACE_HEADER *)raw;
    if (header->AceSize < 16U ||
        header->AceType == ACCESS_DENIED_ACE_TYPE || header->AceType != ACCESS_ALLOWED_ACE_TYPE)
      goto done;
    ace = (ACCESS_ALLOWED_ACE *)raw;
    sid = (PSID)&ace->SidStart;
    if (!IsValidSid(sid) || GetLengthSid(sid) > header->AceSize - 8U) goto done;
    if (EqualSid(sid, identity->sid)) {
      if (header->AceFlags !=
            (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE | CRITICAL_ACE_FLAG) ||
          ace->Mask != FILE_ALL_ACCESS)
        goto done;
      package_aces += 1U;
    } else {
      if ((header->AceFlags & INHERITED_ACE) == 0U) goto done;
      if (EqualSid(sid, root->stable_sid) || EqualSid(sid, system_sid) ||
          EqualSid(sid, administrators_sid)) {
        if (ace->Mask != FILE_ALL_ACCESS) goto done;
      } else if ((ace->Mask & dangerous) != 0U) {
        goto done;
      }
    }
  }
  {
    void *raw = NULL;
    SYSTEM_MANDATORY_LABEL_ACE *label;
    if (!GetAce(sacl, 0U, &raw)) goto done;
    label = (SYSTEM_MANDATORY_LABEL_ACE *)raw;
    if (label->Header.AceSize < 16U ||
        label->Header.AceType != SYSTEM_MANDATORY_LABEL_ACE_TYPE ||
        label->Header.AceFlags != (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE) ||
        label->Mask != SYSTEM_MANDATORY_LABEL_NO_WRITE_UP ||
        !IsValidSid((PSID)&label->SidStart) ||
        GetLengthSid((PSID)&label->SidStart) > label->Header.AceSize - 8U ||
        !EqualSid((PSID)&label->SidStart, low_sid))
      goto done;
  }
  if (package_aces != 1U) goto done;
  *security_length = GetSecurityDescriptorLength(security);
  *security_output = security;
  security = NULL;
  valid = *security_length != 0U;
done:
  if (system_sid != NULL && FreeSid(system_sid) != NULL) root->resource_ambiguous = 1;
  if (administrators_sid != NULL && FreeSid(administrators_sid) != NULL)
    root->resource_ambiguous = 1;
  if (low_sid != NULL && FreeSid(low_sid) != NULL) root->resource_ambiguous = 1;
  if (security != NULL && LocalFree(security) != NULL) root->resource_ambiguous = 1;
  return valid;
}

static int bind_folder(ROOT_CUSTODY *root, PROFILE_IDENTITY *identity, HANDLE *folder_handle) {
  HANDLE candidate = INVALID_HANDLE_VALUE;
  FILE_ID_INFO id;
  BY_HANDLE_FILE_INFORMATION basic;
  PSECURITY_DESCRIPTOR security = NULL;
  DWORD security_length = 0U;
  DWORD path_bytes = (DWORD)identity->folder_units * 2U;
  DWORD domain_bytes = (DWORD)ascii_length("op.windows-profile-folder/v1") + 1U;
  DWORD material_length;
  DWORD cursor = 0;
  BYTE *material = NULL;
  int valid = 0;
  if (*folder_handle != NULL && *folder_handle != INVALID_HANDLE_VALUE) return 0;
  *folder_handle = NULL;
  candidate = CreateFileW(identity->folder, FILE_READ_ATTRIBUTES | READ_CONTROL, FILE_SHARE_READ,
                          NULL, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS |
                          FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  if (candidate == INVALID_HANDLE_VALUE ||
      !GetFileInformationByHandleEx(candidate, FileIdInfo, &id, sizeof(id)) ||
      !GetFileInformationByHandle(candidate, &basic) ||
      (basic.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0U ||
      (basic.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0U || basic.nNumberOfLinks != 1U ||
      !exact_profile_folder_security(root, identity, candidate, &security, &security_length))
    goto done;
  material_length = domain_bytes + 4U + path_bytes + 8U + 16U + 4U + 4U + 4U + security_length;
  material = (BYTE *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, material_length);
  if (material == NULL) goto done;
  copy_bytes(material + cursor, "op.windows-profile-folder/v1", domain_bytes); cursor += domain_bytes;
  write_u32(material + cursor, path_bytes); cursor += 4U;
  copy_bytes(material + cursor, identity->folder, path_bytes); cursor += path_bytes;
  write_u64(material + cursor, id.VolumeSerialNumber); cursor += 8U;
  copy_bytes(material + cursor, id.FileId.Identifier, 16U); cursor += 16U;
  write_u32(material + cursor, basic.dwFileAttributes); cursor += 4U;
  write_u32(material + cursor, basic.nNumberOfLinks); cursor += 4U;
  write_u32(material + cursor, security_length); cursor += 4U;
  copy_bytes(material + cursor, security, security_length);
  if (!sha256(material, material_length, identity->folder_binding,
              &root->resource_ambiguous) || !root_snapshot(root, 0))
    goto done;
  *folder_handle = candidate;
  candidate = INVALID_HANDLE_VALUE;
  valid = 1;
done:
  if (security != NULL && LocalFree(security) != NULL) root->resource_ambiguous = 1;
  if (material != NULL && !HeapFree(GetProcessHeap(), 0U, material))
    root->resource_ambiguous = 1;
  if (candidate != INVALID_HANDLE_VALUE && !CloseHandle(candidate)) root->resource_ambiguous = 1;
  return valid;
}

static int reconcile_attempted_profile(ROOT_CUSTODY *root, PROFILE_IDENTITY *identity,
                                       HANDLE *folder_handle) {
  PSID returned = NULL;
  HRESULT result;
  int absent_before;
  int present_before;
  int present_after;
  if (identity->phase != JOURNAL_PROFILE_ATTEMPTED || identity->folder_units != 0U) return 0;
  absent_before = census_profile(root, identity, 1, 0);
  present_before = absent_before ? 0 : census_profile(root, identity, 0, 1);
  if (!absent_before && !present_before) return 0;
  if (!root_snapshot(root, 0)) return 0;
  result = CreateAppContainerProfile(identity->moniker, identity->moniker, identity->moniker,
                                     NULL, 0U, &returned);
  if (!root_snapshot(root, 0)) {
    if (returned != NULL && FreeSid(returned) != NULL) root->resource_ambiguous = 1;
    return 0;
  }
  if (!FAILED(result)) {
    if (!absent_before || returned == NULL || !IsValidSid(returned) ||
        GetLengthSid(returned) != identity->sid_length ||
        !equal_bytes(returned, identity->sid, identity->sid_length) ||
        forbidden_profile_sid(returned, root)) {
      if (returned != NULL && FreeSid(returned) != NULL) root->resource_ambiguous = 1;
      return 0;
    }
  } else if (result == HRESULT_ALREADY_EXISTS) {
    if (!present_before) {
      if (returned != NULL && FreeSid(returned) != NULL) root->resource_ambiguous = 1;
      return 0;
    }
  }
  if (returned != NULL && FreeSid(returned) != NULL) root->resource_ambiguous = 1;
  present_after = census_profile(root, identity, 0, 1);
  if (!present_after) return 0;
  if (!derive_folder(identity) || !canonical_folder_path(identity->folder, identity->folder_units) ||
      !bind_folder(root, identity, folder_handle) ||
      !persist_phase(root, identity, JOURNAL_PROFILE_CREATED))
    return 0;
  return 1;
}

static int retain_recorded_folder(ROOT_CUSTODY *root, PROFILE_IDENTITY *identity,
                                  HANDLE *folder_handle) {
  PROFILE_IDENTITY observed;
  zero_bytes(&observed, sizeof(observed));
  copy_bytes(observed.sid, identity->sid, identity->sid_length);
  observed.sid_length = identity->sid_length;
  copy_bytes(observed.sid_text, identity->sid_text, identity->sid_text_length + 1U);
  observed.sid_text_length = identity->sid_text_length;
  if (!derive_folder(&observed) || observed.folder_units != identity->folder_units ||
      !equal_bytes(observed.folder, identity->folder, (DWORD)identity->folder_units * 2U) ||
      !bind_folder(root, &observed, folder_handle) ||
      !equal_bytes(observed.folder_binding, identity->folder_binding, 32U)) {
    if (*folder_handle != NULL && *folder_handle != INVALID_HANDLE_VALUE) {
      if (!CloseHandle(*folder_handle)) root->resource_ambiguous = 1;
      *folder_handle = NULL;
    }
    return 0;
  }
  return 1;
}

static void reset_uncommitted_folder(ROOT_CUSTODY *root, PROFILE_IDENTITY *identity,
                                     HANDLE *folder_handle) {
  if (*folder_handle != NULL && *folder_handle != INVALID_HANDLE_VALUE) {
    if (!CloseHandle(*folder_handle)) root->resource_ambiguous = 1;
    *folder_handle = NULL;
  }
  if (identity->phase == JOURNAL_PROFILE_ATTEMPTED) {
    zero_bytes(identity->folder, sizeof(identity->folder));
    identity->folder_units = 0U;
    zero_bytes(identity->folder_binding, sizeof(identity->folder_binding));
  }
}

static int cleanup_profile(ROOT_CUSTODY *root, PROFILE_IDENTITY *identity,
                           HANDLE *folder_handle) {
  if (identity->phase == JOURNAL_PROFILE_ATTEMPTED &&
      !reconcile_attempted_profile(root, identity, folder_handle)) {
    reset_uncommitted_folder(root, identity, folder_handle);
    return 0;
  }
  if (identity->phase == JOURNAL_PROFILE_CREATED &&
      (*folder_handle == NULL || *folder_handle == INVALID_HANDLE_VALUE)) {
    if (!census_profile(root, identity, 0, 1) ||
        !retain_recorded_folder(root, identity, folder_handle))
      return 0;
  }
  if (identity->phase == JOURNAL_PROFILE_DELETE_ATTEMPTED &&
      (*folder_handle == NULL || *folder_handle == INVALID_HANDLE_VALUE)) {
    int present = census_profile(root, identity, 0, 1);
    int absent = present ? 0 : census_profile(root, identity, 1, 0);
    if ((!present && !absent) ||
        (present && !retain_recorded_folder(root, identity, folder_handle)))
      return 0;
  }
  if (*folder_handle != NULL && *folder_handle != INVALID_HANDLE_VALUE) {
    if (!CloseHandle(*folder_handle)) root->resource_ambiguous = 1;
    *folder_handle = NULL;
  }
  if (identity->phase < JOURNAL_PROFILE_DELETE_ATTEMPTED &&
      !persist_phase(root, identity, JOURNAL_PROFILE_DELETE_ATTEMPTED))
    return 0;
  if (!root_snapshot(root, 0)) return 0;
  (void)DeleteAppContainerProfile(identity->moniker);
  if (!root_snapshot(root, 0) || !census_profile(root, identity, 1, 0) || !folder_absent(identity))
    return 0;
  if (!clear_pending(root, identity)) return 0;
  if (!persist_phase(root, identity, JOURNAL_PROFILE_ABSENCE_PROVED)) return 0;
  return 1;
}

#if defined(OP_WINDOWS_PAUSE_AFTER_ATTEMPTED) || defined(OP_WINDOWS_PAUSE_AFTER_CREATE) || \
    defined(OP_WINDOWS_PAUSE_AFTER_EXECUTION_ATTEMPTED) || \
    defined(OP_WINDOWS_PAUSE_AFTER_EXECUTION_MKDIR) || \
    defined(OP_WINDOWS_PAUSE_AFTER_EXECUTION_CREATED)
static void diagnostic_pause(void) {
  BYTE resumed;
  DWORD received = 0U;
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
#if defined(OP_WINDOWS_PAUSE_AFTER_ATTEMPTED)
  diagnostic("windows-broker:pause-after-attempted\n");
#elif defined(OP_WINDOWS_PAUSE_AFTER_CREATE)
  diagnostic("windows-broker:pause-after-create\n");
#elif defined(OP_WINDOWS_PAUSE_AFTER_EXECUTION_ATTEMPTED)
  diagnostic("windows-broker:pause-after-execution-attempted\n");
#elif defined(OP_WINDOWS_PAUSE_AFTER_EXECUTION_MKDIR)
  diagnostic("windows-broker:pause-after-execution-mkdir\n");
#else
  diagnostic("windows-broker:pause-after-execution-created\n");
#endif
  if (input == NULL || input == INVALID_HANDLE_VALUE ||
      !ReadFile(input, &resumed, 1U, &received, NULL) || received != 1U)
    ExitProcess(EXIT_RECOVERY_REQUIRED);
}
#endif

static int create_profile(ROOT_CUSTODY *root, PROFILE_IDENTITY *identity,
                          HANDLE *folder_handle) {
  PSID returned = NULL;
  HRESULT result;
  DWORD attempts;
  for (attempts = 0; attempts < 128U; attempts += 1U) {
    if (generate_identity(root, identity) && token_paths_absent(root, identity->token)) break;
  }
  if (attempts == 128U || !census_profile(root, identity, 1, 0))
    return 0;
  if (!persist_phase(root, identity, JOURNAL_USED)) return -1;
  if (!persist_phase(root, identity, JOURNAL_PROFILE_ATTEMPTED)) {
    if (identity->phase == JOURNAL_PROFILE_ATTEMPTED)
      return cleanup_profile(root, identity, folder_handle) ? 0 : -1;
    return -1;
  }
#if defined(OP_WINDOWS_PAUSE_AFTER_ATTEMPTED)
  diagnostic_pause();
#endif
  if (!root_snapshot(root, 0))
    return cleanup_profile(root, identity, folder_handle) ? 0 : -1;
  result = CreateAppContainerProfile(identity->moniker, identity->moniker, identity->moniker,
                                     NULL, 0U, &returned);
#if defined(OP_WINDOWS_PAUSE_AFTER_CREATE)
  diagnostic_pause();
#endif
  if (!root_snapshot(root, 0)) {
    if (returned != NULL && FreeSid(returned) != NULL) root->resource_ambiguous = 1;
    return cleanup_profile(root, identity, folder_handle) ? 0 : -1;
  }
  if (FAILED(result) || returned == NULL || !IsValidSid(returned) ||
      GetLengthSid(returned) != identity->sid_length ||
      !equal_bytes(returned, identity->sid, identity->sid_length) ||
      forbidden_profile_sid(returned, root)) {
    if (returned != NULL && FreeSid(returned) != NULL) root->resource_ambiguous = 1;
    return cleanup_profile(root, identity, folder_handle) ? 0 : -1;
  }
  if (FreeSid(returned) != NULL) {
    root->resource_ambiguous = 1;
    return cleanup_profile(root, identity, folder_handle) ? 0 : -1;
  }
  if (!census_profile(root, identity, 0, 1) || !derive_folder(identity) ||
      !canonical_folder_path(identity->folder, identity->folder_units) ||
      !bind_folder(root, identity, folder_handle) ||
      !persist_phase(root, identity, JOURNAL_PROFILE_CREATED))
    return cleanup_profile(root, identity, folder_handle) ? 0 : -1;
  if (root->resource_ambiguous) {
    int clean = cleanup_profile(root, identity, folder_handle);
    if (!clean) root->resource_ambiguous = 1;
    return -1;
  }
  return 1;
}

static int recover_groups(ROOT_CUSTODY *root, JOURNAL_GROUP *groups, DWORD count) {
  DWORD index;
  int census_result = complete_profile_census(root, groups, count);
  if (census_result <= 0) {
    return census_result;
  }
  if (!root_snapshot(root, 0)) {
    return count == 0U ? 0 : -1;
  }
  for (index = 0; index < count; index += 1U) {
    PROFILE_IDENTITY *identity = &groups[index].identity;
    EXECUTION_CUSTODY *execution = groups[index].execution;
    HANDLE folder_handle = NULL;
    if (execution != NULL && execution->phase != EXECUTION_ABSENCE_PROVED) {
      if (!cleanup_execution(root, identity, execution)) {
        (void)release_execution(root, execution);
        if (!HeapFree(GetProcessHeap(), 0U, execution)) root->resource_ambiguous = 1;
        groups[index].execution = NULL;
        return -1;
      }
    }
    if (!clear_execution_pending(root, identity) ||
        (execution != NULL && execution->phase != EXECUTION_ABSENCE_PROVED)) {
      if (execution != NULL) {
        (void)release_execution(root, execution);
        if (!HeapFree(GetProcessHeap(), 0U, execution)) root->resource_ambiguous = 1;
        groups[index].execution = NULL;
      }
      return -1;
    }
    if (execution != NULL) {
      if (!release_execution(root, execution) ||
          !HeapFree(GetProcessHeap(), 0U, execution))
        return -1;
      groups[index].execution = NULL;
    }
    if (identity->phase == 0U) {
      if (!census_profile(root, identity, 1, 0) || !clear_pending(root, identity))
        return -1;
      continue;
    }
    if (identity->phase == JOURNAL_USED) {
      if (!census_profile(root, identity, 1, 0) || !clear_pending(root, identity))
        return -1;
      continue;
    }
    if (identity->phase == JOURNAL_PROFILE_ABSENCE_PROVED) {
      if (!census_profile(root, identity, 1, 0) || !folder_absent(identity) ||
          !clear_pending(root, identity))
        return -1;
      continue;
    }
    if (identity->phase < JOURNAL_PROFILE_ATTEMPTED ||
        identity->phase > JOURNAL_PROFILE_DELETE_ATTEMPTED ||
        !cleanup_profile(root, identity, &folder_handle))
      return -1;
  }
  return root_snapshot(root, 0) ? 1 : (count == 0U ? 0 : -1);
}

static void free_group_executions(ROOT_CUSTODY *root, JOURNAL_GROUP *groups,
                                  DWORD count) {
  DWORD index;
  for (index = 0U; index < count; index += 1U) {
    if (groups[index].execution != NULL) {
      (void)release_execution(root, groups[index].execution);
      if (!HeapFree(GetProcessHeap(), 0U, groups[index].execution))
        root->resource_ambiguous = 1;
      groups[index].execution = NULL;
    }
  }
}

static int preflight_and_recover(ROOT_CUSTODY *root) {
  JOURNAL_GROUP *groups = NULL;
  DWORD count = 0;
  DWORD initial_count;
  int result;
  result = scan_journals(root, &groups, &count);
  if (result <= 0) return result;
  initial_count = count;
  result = recover_groups(root, groups, count);
  free_group_executions(root, groups, count);
  if (!HeapFree(GetProcessHeap(), 0U, groups)) root->resource_ambiguous = 1;
  if (result <= 0) {
    return result < 0 || initial_count != 0U || root->resource_ambiguous ? -1 : 0;
  }
  result = scan_journals(root, &groups, &count);
  if (result <= 0) return -1;
  result = complete_profile_census(root, groups, count);
  if (result > 0 && !root_snapshot(root, 0)) result = -1;
  free_group_executions(root, groups, count);
  if (!HeapFree(GetProcessHeap(), 0U, groups)) root->resource_ambiguous = 1;
  return root->resource_ambiguous ? -1 : result;
}

static DWORD prepare_response(const PROFILE_IDENTITY *identity,
                              const EXECUTION_CUSTODY *execution,
                              BYTE *response, DWORD capacity) {
  DWORD folder_bytes = (DWORD)identity->folder_units * 2U;
  DWORD execution_root_bytes = (DWORD)execution->root.path_units * 2U;
  DWORD needed = 8U + 32U + 64U + 2U + identity->sid_length + 2U +
                 identity->sid_text_length + 2U + folder_bytes + 2U +
                 execution_root_bytes + 32U;
  DWORD cursor = 8U;
  DWORD index;
  if (needed > capacity) return 0U;
  zero_bytes(response, needed);
  response[0] = 'O'; response[1] = 'P'; response[2] = 'W'; response[3] = 'R';
  response[4] = 1U; response[5] = 2U;
  copy_bytes(response + cursor, identity->token, 32U); cursor += 32U;
  for (index = 0; index < 64U; index += 1U)
    response[cursor + index] = (BYTE)identity->moniker[index];
  cursor += 64U;
  write_u16(response + cursor, identity->sid_length); cursor += 2U;
  copy_bytes(response + cursor, identity->sid, identity->sid_length); cursor += identity->sid_length;
  write_u16(response + cursor, identity->sid_text_length); cursor += 2U;
  copy_bytes(response + cursor, identity->sid_text, identity->sid_text_length); cursor += identity->sid_text_length;
  write_u16(response + cursor, identity->folder_units); cursor += 2U;
  copy_bytes(response + cursor, identity->folder, folder_bytes); cursor += folder_bytes;
  write_u16(response + cursor, execution->root.path_units); cursor += 2U;
  copy_bytes(response + cursor, execution->root.path, execution_root_bytes);
  cursor += execution_root_bytes;
  copy_bytes(response + cursor, execution->root_binding, 32U);
  return needed;
}

typedef enum broker_lifecycle_state {
  BROKER_EMPTY = 0,
  BROKER_PREPARED = 1,
  BROKER_TERMINAL = 2
} BROKER_LIFECYCLE_STATE;

static __declspec(noreturn) void finish_prepared(ROOT_CUSTODY *root,
                                                  PROFILE_IDENTITY *identity,
                                                  EXECUTION_CUSTODY *execution,
                                                  HANDLE *folder_handle, HANDLE output,
                                                  BYTE operation, int respond,
                                                  BROKER_LIFECYCLE_STATE *state) {
  int clean = *state == BROKER_PREPARED;
  if (clean && execution->phase != 0U &&
      execution->phase != EXECUTION_ABSENCE_PROVED)
    clean = OP_BROKER_CLEANUP_EXECUTION(root, identity, execution);
  if (clean) clean = OP_BROKER_CLEANUP_PROFILE(root, identity, folder_handle);
  *state = BROKER_TERMINAL;
  if (!OP_BROKER_RELEASE_EXECUTION(root, execution)) clean = 0;
  if (!HeapFree(GetProcessHeap(), 0U, execution)) clean = 0;
  int released = OP_BROKER_RELEASE_ROOT(root);
  BYTE status = clean && released ? STATUS_REFUSED : STATUS_RECOVERY_REQUIRED;
  if (respond) (void)send_response(output, operation, status, NULL, 0U);
  ExitProcess(status == STATUS_RECOVERY_REQUIRED ? EXIT_RECOVERY_REQUIRED : EXIT_PROTOCOL_REFUSED);
}

static __declspec(noreturn) void serve(void) {
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
  BROKER_FRAME frame;
  ROOT_CUSTODY root;
  PROFILE_IDENTITY identity;
  EXECUTION_CUSTODY *execution;
  EXECUTION_PREPARE_PATHS *paths;
  HANDLE folder_handle = NULL;
  BYTE response[4096];
  DWORD response_length;
  int result;
  int preflight_result;
  BROKER_LIFECYCLE_STATE state = BROKER_EMPTY;
  if (input == NULL || input == INVALID_HANDLE_VALUE || output == NULL ||
      output == INVALID_HANDLE_VALUE)
    protocol_refused();
  if (read_frame(input, &frame, 1) != 1) protocol_refused();
  if (!canonical_frame_payload(&frame)) protocol_refused();
  if (frame.operation != PREPARE_OPERATION) {
    (void)send_response(output, frame.operation, STATUS_REFUSED, NULL, 0U);
    ExitProcess(EXIT_PROTOCOL_REFUSED);
  }
  execution = (EXECUTION_CUSTODY *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY,
                                             sizeof(EXECUTION_CUSTODY));
  paths = (EXECUTION_PREPARE_PATHS *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY,
                                               sizeof(EXECUTION_PREPARE_PATHS));
  if (execution == NULL || paths == NULL ||
      !canonical_execution_prepare(frame.payload, frame.length, paths))
    protocol_refused();
  if (!OP_BROKER_RETAIN_ROOT(paths->state_root, paths->state_root_units, &root)) {
    int paths_freed = HeapFree(GetProcessHeap(), 0U, paths);
    int execution_freed = HeapFree(GetProcessHeap(), 0U, execution);
    int allocation_clean = paths_freed && execution_freed;
    int released = OP_BROKER_RELEASE_ROOT(&root);
    BYTE status = released && allocation_clean ? STATUS_REFUSED : STATUS_RECOVERY_REQUIRED;
    (void)send_response(output, PREPARE_OPERATION, status, NULL, 0U);
    ExitProcess(status == STATUS_REFUSED ? EXIT_PROTOCOL_REFUSED : EXIT_RECOVERY_REQUIRED);
  }
  preflight_result = OP_BROKER_PREFLIGHT(&root);
  if (preflight_result <= 0) {
    int paths_freed = HeapFree(GetProcessHeap(), 0U, paths);
    int execution_freed = HeapFree(GetProcessHeap(), 0U, execution);
    if (!paths_freed || !execution_freed)
      preflight_result = -1;
    int released = OP_BROKER_RELEASE_ROOT(&root);
    if (!released) preflight_result = -1;
    send_response(output, PREPARE_OPERATION,
                  preflight_result < 0 ? STATUS_RECOVERY_REQUIRED : STATUS_REFUSED, NULL, 0U);
    ExitProcess(preflight_result < 0 ? EXIT_RECOVERY_REQUIRED : EXIT_PROTOCOL_REFUSED);
  }
  result = OP_BROKER_CREATE_PROFILE(&root, &identity, &folder_handle);
  if (result <= 0) {
    int paths_freed = HeapFree(GetProcessHeap(), 0U, paths);
    int execution_freed = HeapFree(GetProcessHeap(), 0U, execution);
    if (!paths_freed || !execution_freed)
      result = -1;
    int released = OP_BROKER_RELEASE_ROOT(&root);
    if (!released) result = -1;
    send_response(output, PREPARE_OPERATION,
                  result < 0 ? STATUS_RECOVERY_REQUIRED : STATUS_REFUSED, NULL, 0U);
    ExitProcess(result < 0 ? EXIT_RECOVERY_REQUIRED : EXIT_PROTOCOL_REFUSED);
  }
  if (!OP_BROKER_RETAIN_EXECUTION(&root, paths, &identity, execution)) {
    if (!HeapFree(GetProcessHeap(), 0U, paths)) root.resource_ambiguous = 1;
  } else if (!HeapFree(GetProcessHeap(), 0U, paths)) {
    root.resource_ambiguous = 1;
  }
  paths = NULL;
  if (root.resource_ambiguous || execution->root.path_units == 0U ||
      !OP_BROKER_CONSTRUCT_EXECUTION(&root, &identity, execution)) {
    int clean = 1;
    if (execution->phase != 0U && execution->phase != EXECUTION_ABSENCE_PROVED)
      clean = OP_BROKER_CLEANUP_EXECUTION(&root, &identity, execution);
    if (clean) clean = OP_BROKER_CLEANUP_PROFILE(&root, &identity, &folder_handle);
    if (!OP_BROKER_RELEASE_EXECUTION(&root, execution)) clean = 0;
    if (!HeapFree(GetProcessHeap(), 0U, execution)) clean = 0;
    if (!OP_BROKER_RELEASE_ROOT(&root)) clean = 0;
    send_response(output, PREPARE_OPERATION,
                  clean ? STATUS_REFUSED : STATUS_RECOVERY_REQUIRED, NULL, 0U);
    ExitProcess(clean ? EXIT_PROTOCOL_REFUSED : EXIT_RECOVERY_REQUIRED);
  }
  state = BROKER_PREPARED;
  response_length = prepare_response(&identity, execution, response, sizeof(response));
  if (response_length == 0U) {
    finish_prepared(&root, &identity, execution, &folder_handle, output,
                    PREPARE_OPERATION, 1, &state);
  }
  if (!send_response(output, PREPARE_OPERATION, STATUS_OK, response, response_length))
    finish_prepared(&root, &identity, execution, &folder_handle, output,
                    PREPARE_OPERATION, 0, &state);
  for (;;) {
    int next = read_frame(input, &frame, 0);
    if (next <= 0) {
      finish_prepared(&root, &identity, execution, &folder_handle, output,
                      PREPARE_OPERATION, 0, &state);
    }
    if (!canonical_frame_payload(&frame)) {
      finish_prepared(&root, &identity, execution, &folder_handle, output,
                      frame.operation, 0, &state);
    }
    if (frame.operation == LAUNCH_OPERATION && frame.length == 0U) {
      if (!send_response(output, LAUNCH_OPERATION, STATUS_NOT_IMPLEMENTED, NULL, 0U))
        finish_prepared(&root, &identity, execution, &folder_handle, output,
                        LAUNCH_OPERATION, 0, &state);
      continue;
    }
    if (frame.operation == TEARDOWN_OPERATION && frame.length == 0U) {
      BYTE trailing;
      int clean;
      int released;
      if (read_one(input, &trailing) != 0)
        finish_prepared(&root, &identity, execution, &folder_handle, output,
                        TEARDOWN_OPERATION, 0, &state);
      clean = OP_BROKER_CLEANUP_EXECUTION(&root, &identity, execution);
      if (clean) clean = OP_BROKER_CLEANUP_PROFILE(&root, &identity, &folder_handle);
      state = BROKER_TERMINAL;
      if (!OP_BROKER_RELEASE_EXECUTION(&root, execution)) clean = 0;
      if (!HeapFree(GetProcessHeap(), 0U, execution)) clean = 0;
      released = OP_BROKER_RELEASE_ROOT(&root);
      if (!clean || !released) {
        (void)send_response(output, TEARDOWN_OPERATION, STATUS_RECOVERY_REQUIRED, NULL, 0U);
        ExitProcess(EXIT_RECOVERY_REQUIRED);
      }
      if (!send_response(output, TEARDOWN_OPERATION, STATUS_OK, NULL, 0U))
        ExitProcess(EXIT_PROTOCOL_REFUSED);
      ExitProcess(0U);
    }
    finish_prepared(&root, &identity, execution, &folder_handle, output,
                    frame.operation, 1, &state);
  }
}

static __declspec(noreturn) void recover(void) {
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
  BROKER_FRAME frame;
  WCHAR path[PATH_MAX_UNITS + 1U];
  WORD path_units = 0;
  BYTE trailing;
  ROOT_CUSTODY root;
  int preflight_result;
  if (input == NULL || input == INVALID_HANDLE_VALUE || output == NULL ||
      output == INVALID_HANDLE_VALUE)
    protocol_refused();
  if (read_frame(input, &frame, 1) != 1) protocol_refused();
  if ((frame.operation == TEARDOWN_OPERATION &&
       !canonical_scope_path(frame.payload, frame.length, path, &path_units)) ||
      (frame.operation != TEARDOWN_OPERATION && !canonical_frame_payload(&frame)) ||
      read_one(input, &trailing) != 0)
    protocol_refused();
  if (frame.operation != TEARDOWN_OPERATION) {
    (void)send_response(output, frame.operation, STATUS_REFUSED, NULL, 0U);
    ExitProcess(EXIT_PROTOCOL_REFUSED);
  }
  if (!OP_BROKER_RETAIN_ROOT(path, path_units, &root)) {
    int released = OP_BROKER_RELEASE_ROOT(&root);
    BYTE status = released ? STATUS_REFUSED : STATUS_RECOVERY_REQUIRED;
    (void)send_response(output, TEARDOWN_OPERATION, status, NULL, 0U);
    ExitProcess(released ? EXIT_PROTOCOL_REFUSED : EXIT_RECOVERY_REQUIRED);
  }
  preflight_result = OP_BROKER_PREFLIGHT(&root);
  if (preflight_result <= 0) {
    int released = OP_BROKER_RELEASE_ROOT(&root);
    if (!released) preflight_result = -1;
    send_response(output, TEARDOWN_OPERATION,
                  preflight_result < 0 ? STATUS_RECOVERY_REQUIRED : STATUS_REFUSED, NULL, 0U);
    ExitProcess(preflight_result < 0 ? EXIT_RECOVERY_REQUIRED : EXIT_PROTOCOL_REFUSED);
  }
  if (!OP_BROKER_RELEASE_ROOT(&root)) {
    (void)send_response(output, TEARDOWN_OPERATION, STATUS_RECOVERY_REQUIRED, NULL, 0U);
    ExitProcess(EXIT_RECOVERY_REQUIRED);
  }
  if (!send_response(output, TEARDOWN_OPERATION, STATUS_OK, NULL, 0U))
    ExitProcess(EXIT_PROTOCOL_REFUSED);
  ExitProcess(0U);
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
  return *cursor == L'\0';
}

__declspec(noreturn) void broker_entry(void) {
  WCHAR *mode = NULL;
  if (image_relocation_anchor == NULL) ExitProcess(EXIT_ARGUMENT_REFUSED);
  if (!parse_mode(GetCommandLineW(), &mode)) {
    diagnostic("windows-broker:arguments\n");
    ExitProcess(EXIT_ARGUMENT_REFUSED);
  }
  if (wide_equal(mode, serve_mode)) serve();
  if (wide_equal(mode, recover_mode)) recover();
  diagnostic("windows-broker:arguments\n");
  ExitProcess(EXIT_ARGUMENT_REFUSED);
}
