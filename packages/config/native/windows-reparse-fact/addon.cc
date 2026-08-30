#include <node_api.h>

#include <array>
#include <cstdio>
#include <string>

#include "observation-core.h"

namespace {

using orchestration_platform::windows_reparse::Observation;
using orchestration_platform::windows_reparse::ObservePath;

void Refuse(napi_env environment) {
  napi_throw_error(environment, "ERR_WINDOWS_REPARSE_OBSERVATION_REFUSED",
                   "Windows reparse observation refused");
}

bool ReadPath(napi_env environment, napi_value value, std::wstring* path) {
  napi_valuetype type;
  std::size_t length = 0;
  if (napi_typeof(environment, value, &type) != napi_ok || type != napi_string ||
      napi_get_value_string_utf16(environment, value, nullptr, 0, &length) != napi_ok ||
      length == 0 || length > 32767) {
    return false;
  }
  std::wstring buffer(length + 1, L'\0');
  std::size_t copied = 0;
  if (napi_get_value_string_utf16(environment, value,
                                  reinterpret_cast<char16_t*>(buffer.data()), buffer.size(),
                                  &copied) != napi_ok ||
      copied != length) {
    return false;
  }
  buffer.resize(length);
  if (buffer.find(L'\0') != std::wstring::npos) return false;
  *path = std::move(buffer);
  return true;
}

bool Set(napi_env environment, napi_value object, const char* name, napi_value value) {
  return napi_set_named_property(environment, object, name, value) == napi_ok;
}

napi_value String(napi_env environment, const std::string& value) {
  napi_value result;
  if (napi_create_string_utf8(environment, value.data(), value.size(), &result) != napi_ok) {
    return nullptr;
  }
  return result;
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

napi_value Observe(napi_env environment, napi_callback_info info) {
  std::size_t count = 2;
  napi_value arguments[2];
  if (napi_get_cb_info(environment, info, &count, arguments, nullptr, nullptr) != napi_ok ||
      count != 1) {
    Refuse(environment);
    return nullptr;
  }
  std::wstring path;
  Observation observation{};
  if (!ReadPath(environment, arguments[0], &path) || !ObservePath(path, &observation)) {
    Refuse(environment);
    return nullptr;
  }
  napi_value result = ToValue(environment, observation);
  if (result == nullptr) Refuse(environment);
  return result;
}

napi_value Initialize(napi_env environment, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"observe", nullptr, Observe, nullptr, nullptr, nullptr, napi_enumerable, nullptr},
  };
  if (napi_define_properties(environment, exports, 1, properties) != napi_ok) {
    Refuse(environment);
    return nullptr;
  }
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
