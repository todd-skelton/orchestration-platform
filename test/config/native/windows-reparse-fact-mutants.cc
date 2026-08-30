#include <aclapi.h>
#include <node_api.h>
#include <windows.h>

#include <array>
#include <cstdio>
#include <string>
#include <vector>

#include "../../../packages/config/native/windows-reparse-fact/observation-core.h"

namespace {

using orchestration_platform::windows_reparse::ExtendedLocalPath;
using orchestration_platform::windows_reparse::Observation;
using orchestration_platform::windows_reparse::ObserveHandle;
using orchestration_platform::windows_reparse::ObservePath;
using orchestration_platform::windows_reparse::OpenObservationHandle;

void Refuse(napi_env environment) {
  napi_throw_error(environment, "ERR_WINDOWS_REPARSE_MUTANT_REFUSED",
                   "Windows reparse mutant refused");
}

bool ReadString(napi_env environment, napi_value value, std::wstring* output) {
  napi_valuetype type;
  std::size_t length = 0;
  if (napi_typeof(environment, value, &type) != napi_ok || type != napi_string ||
      napi_get_value_string_utf16(environment, value, nullptr, 0, &length) != napi_ok ||
      length == 0 || length > 32767) {
    return false;
  }
  std::wstring text(length + 1, L'\0');
  std::size_t copied = 0;
  if (napi_get_value_string_utf16(environment, value,
                                  reinterpret_cast<char16_t*>(text.data()), text.size(),
                                  &copied) != napi_ok ||
      copied != length) {
    return false;
  }
  text.resize(length);
  if (text.find(L'\0') != std::wstring::npos) return false;
  *output = std::move(text);
  return true;
}

bool Set(napi_env environment, napi_value object, const char* name, napi_value value) {
  return napi_set_named_property(environment, object, name, value) == napi_ok;
}

napi_value String(napi_env environment, const std::string& value) {
  napi_value result;
  return napi_create_string_utf8(environment, value.data(), value.size(), &result) == napi_ok
             ? result
             : nullptr;
}

std::string Hex64(std::uint64_t value) {
  std::array<char, 17> text{};
  std::snprintf(text.data(), text.size(), "%016llx",
                static_cast<unsigned long long>(value));
  return std::string(text.data(), 16);
}

std::string Hex32(std::uint32_t value) {
  std::array<char, 9> text{};
  std::snprintf(text.data(), text.size(), "%08lx", static_cast<unsigned long>(value));
  return std::string(text.data(), 8);
}

std::string Hex128(const std::array<unsigned char, 16>& value) {
  constexpr char digits[] = "0123456789abcdef";
  std::string text(32, '0');
  for (std::size_t index = 0; index < value.size(); ++index) {
    text[index * 2] = digits[value[index] >> 4];
    text[index * 2 + 1] = digits[value[index] & 0x0f];
  }
  return text;
}

napi_value Coordinate(napi_env environment, std::uint64_t value, const std::string& hexadecimal) {
  napi_value coordinate;
  if (napi_create_object(environment, &coordinate) != napi_ok ||
      !Set(environment, coordinate, "decimal", String(environment, std::to_string(value))) ||
      !Set(environment, coordinate, "hexadecimal", String(environment, hexadecimal))) {
    return nullptr;
  }
  return coordinate;
}

napi_value ToValue(napi_env environment, const Observation& observation) {
  napi_value result;
  napi_value identity;
  napi_value value;
  if (napi_create_object(environment, &result) != napi_ok ||
      napi_create_object(environment, &identity) != napi_ok ||
      !Set(environment, identity, "fileId", String(environment, Hex128(observation.file_id))) ||
      !Set(environment, identity, "nodeDevice",
           Coordinate(environment, observation.node_device, Hex32(observation.node_device))) ||
      !Set(environment, identity, "nodeInode",
           Coordinate(environment, observation.node_inode, Hex64(observation.node_inode))) ||
      !Set(environment, identity, "volumeSerialNumber",
           String(environment, Hex64(observation.volume_serial_number))) ||
      !Set(environment, result, "identity", identity) ||
      napi_create_string_utf8(environment, observation.directory ? "DIRECTORY" : "FILE",
                              NAPI_AUTO_LENGTH, &value) != napi_ok ||
      !Set(environment, result, "kind", value) ||
      napi_get_boolean(environment, observation.reparse_point, &value) != napi_ok ||
      !Set(environment, result, "reparsePoint", value)) {
    return nullptr;
  }
  if (observation.reparse_point) {
    if (napi_create_uint32(environment, observation.reparse_tag, &value) != napi_ok) return nullptr;
  } else if (napi_get_null(environment, &value) != napi_ok) {
    return nullptr;
  }
  return Set(environment, result, "reparseTag", value) ? result : nullptr;
}

bool SameIdentity(const Observation& left, const Observation& right) {
  return left.volume_serial_number == right.volume_serial_number && left.file_id == right.file_id;
}

napi_value ReplaceRestore(napi_env environment, napi_callback_info info) {
  std::size_t count = 3;
  napi_value arguments[3];
  std::wstring original;
  std::wstring replacement;
  if (napi_get_cb_info(environment, info, &count, arguments, nullptr, nullptr) != napi_ok ||
      count != 2 || !ReadString(environment, arguments[0], &original) ||
      !ReadString(environment, arguments[1], &replacement)) {
    Refuse(environment);
    return nullptr;
  }

  const std::wstring held = original + L".iss003-held";
  HANDLE retained = OpenObservationHandle(original);
  Observation before{};
  Observation during{};
  Observation after{};
  Observation replacement_during{};
  bool original_held = false;
  bool replacement_installed = false;
  bool valid = retained != INVALID_HANDLE_VALUE && ObserveHandle(retained, &before);

  if (valid && MoveFileExW(ExtendedLocalPath(original).c_str(), ExtendedLocalPath(held).c_str(),
                           MOVEFILE_WRITE_THROUGH)) {
    original_held = true;
  } else {
    valid = false;
  }
  if (valid && MoveFileExW(ExtendedLocalPath(replacement).c_str(),
                           ExtendedLocalPath(original).c_str(), MOVEFILE_WRITE_THROUGH)) {
    replacement_installed = true;
  } else {
    valid = false;
  }
  if (valid) {
    valid = ObserveHandle(retained, &during) && ObservePath(original, &replacement_during);
  }

  if (replacement_installed) {
    if (MoveFileExW(ExtendedLocalPath(original).c_str(), ExtendedLocalPath(replacement).c_str(),
                    MOVEFILE_WRITE_THROUGH)) {
      replacement_installed = false;
    } else {
      valid = false;
    }
  }
  if (original_held) {
    if (MoveFileExW(ExtendedLocalPath(held).c_str(), ExtendedLocalPath(original).c_str(),
                    MOVEFILE_WRITE_THROUGH)) {
      original_held = false;
    } else {
      valid = false;
    }
  }
  if (retained != INVALID_HANDLE_VALUE) {
    valid = ObserveHandle(retained, &after) && CloseHandle(retained) != 0 && valid;
  }
  if (!valid || original_held || replacement_installed || !SameIdentity(before, during) ||
      !SameIdentity(before, after) || SameIdentity(before, replacement_during)) {
    Refuse(environment);
    return nullptr;
  }

  napi_value result;
  if (napi_create_object(environment, &result) != napi_ok ||
      !Set(environment, result, "after", ToValue(environment, after)) ||
      !Set(environment, result, "before", ToValue(environment, before)) ||
      !Set(environment, result, "during", ToValue(environment, during)) ||
      !Set(environment, result, "replacement", ToValue(environment, replacement_during))) {
    Refuse(environment);
    return nullptr;
  }
  return result;
}

bool CurrentUserSid(std::vector<unsigned char>* buffer, PSID* sid) {
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return false;
  DWORD length = 0;
  GetTokenInformation(token, TokenUser, nullptr, 0, &length);
  if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || length == 0) {
    CloseHandle(token);
    return false;
  }
  buffer->resize(length);
  const bool read = GetTokenInformation(token, TokenUser, buffer->data(), length, &length) != 0;
  const bool closed = CloseHandle(token) != 0;
  if (!read || !closed) return false;
  *sid = reinterpret_cast<TOKEN_USER*>(buffer->data())->User.Sid;
  return IsValidSid(*sid) != 0;
}

napi_value AclMutant(napi_env environment, napi_callback_info info) {
  std::size_t count = 2;
  napi_value arguments[2];
  std::wstring path;
  if (napi_get_cb_info(environment, info, &count, arguments, nullptr, nullptr) != napi_ok ||
      count != 1 || !ReadString(environment, arguments[0], &path)) {
    Refuse(environment);
    return nullptr;
  }

  const std::wstring extended_path = ExtendedLocalPath(path);
  PACL original_acl = nullptr;
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  PACL denied_acl = nullptr;
  std::vector<unsigned char> token_user;
  PSID user_sid = nullptr;
  bool acl_installed = false;
  bool renamed = false;
  const std::wstring held = path + L".iss003-held";
  Observation observation{};
  bool read_write_denied = false;
  bool rename_allowed = false;

  DWORD status = GetNamedSecurityInfoW(
      const_cast<wchar_t*>(extended_path.c_str()), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION,
      nullptr, nullptr, &original_acl, nullptr, &descriptor);
  EXPLICIT_ACCESSW entry{};
  if (status == ERROR_SUCCESS && CurrentUserSid(&token_user, &user_sid)) {
    entry.grfAccessPermissions = FILE_WRITE_DATA;
    entry.grfAccessMode = DENY_ACCESS;
    entry.grfInheritance = NO_INHERITANCE;
    BuildTrusteeWithSidW(&entry.Trustee, user_sid);
    status = SetEntriesInAclW(1, &entry, original_acl, &denied_acl);
  }
  if (status == ERROR_SUCCESS) {
    status = SetNamedSecurityInfoW(const_cast<wchar_t*>(extended_path.c_str()), SE_FILE_OBJECT,
                                   DACL_SECURITY_INFORMATION, nullptr, nullptr, denied_acl,
                                   nullptr);
    acl_installed = status == ERROR_SUCCESS;
  }
  if (acl_installed) {
    HANDLE writable = CreateFileW(extended_path.c_str(), GENERIC_READ | GENERIC_WRITE,
                                  FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                                  OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (writable == INVALID_HANDLE_VALUE) {
      read_write_denied = GetLastError() == ERROR_ACCESS_DENIED;
    } else {
      CloseHandle(writable);
    }
    const bool observed = ObservePath(path, &observation);
    renamed = MoveFileExW(extended_path.c_str(), ExtendedLocalPath(held).c_str(),
                          MOVEFILE_WRITE_THROUGH) != 0;
    if (renamed) {
      rename_allowed = MoveFileExW(ExtendedLocalPath(held).c_str(), extended_path.c_str(),
                                   MOVEFILE_WRITE_THROUGH) != 0;
      renamed = !rename_allowed;
    }
    acl_installed =
        SetNamedSecurityInfoW(const_cast<wchar_t*>(extended_path.c_str()), SE_FILE_OBJECT,
                              DACL_SECURITY_INFORMATION, nullptr, nullptr, original_acl,
                              nullptr) != ERROR_SUCCESS;
    if (!observed) read_write_denied = false;
  }

  if (renamed) {
    MoveFileExW(ExtendedLocalPath(held).c_str(), extended_path.c_str(), MOVEFILE_WRITE_THROUGH);
  }
  if (acl_installed) {
    SetNamedSecurityInfoW(const_cast<wchar_t*>(extended_path.c_str()), SE_FILE_OBJECT,
                          DACL_SECURITY_INFORMATION, nullptr, nullptr, original_acl, nullptr);
  }
  if (denied_acl != nullptr) LocalFree(denied_acl);
  if (descriptor != nullptr) LocalFree(descriptor);

  if (!read_write_denied || !rename_allowed || acl_installed || renamed) {
    Refuse(environment);
    return nullptr;
  }
  napi_value result;
  napi_value boolean;
  if (napi_create_object(environment, &result) != napi_ok ||
      napi_get_boolean(environment, read_write_denied, &boolean) != napi_ok ||
      !Set(environment, result, "readWriteDenied", boolean) ||
      napi_get_boolean(environment, rename_allowed, &boolean) != napi_ok ||
      !Set(environment, result, "renameAllowed", boolean) ||
      !Set(environment, result, "observation", ToValue(environment, observation))) {
    Refuse(environment);
    return nullptr;
  }
  return result;
}

napi_value Initialize(napi_env environment, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"aclMutant", nullptr, AclMutant, nullptr, nullptr, nullptr, napi_enumerable, nullptr},
      {"replaceRestore", nullptr, ReplaceRestore, nullptr, nullptr, nullptr, napi_enumerable,
       nullptr},
  };
  if (napi_define_properties(environment, exports, 2, properties) != napi_ok) {
    Refuse(environment);
    return nullptr;
  }
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
