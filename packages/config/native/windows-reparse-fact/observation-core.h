#ifndef ORCHESTRATION_PLATFORM_WINDOWS_REPARSE_OBSERVATION_CORE_H_
#define ORCHESTRATION_PLATFORM_WINDOWS_REPARSE_OBSERVATION_CORE_H_

#include <windows.h>

#include <array>
#include <cstdint>
#include <string>

namespace orchestration_platform::windows_reparse {

struct Observation {
  bool directory;
  bool reparse_point;
  DWORD reparse_tag;
  DWORD node_device;
  std::uint64_t node_inode;
  std::uint64_t volume_serial_number;
  std::array<unsigned char, 16> file_id;
};

inline std::wstring ExtendedLocalPath(const std::wstring& path) {
  return path.rfind(LR"(\\?\)", 0) == 0 ? path : LR"(\\?\)" + path;
}

inline bool ObserveHandle(HANDLE handle, Observation* observation) {
  FILE_ID_INFO identity{};
  FILE_ATTRIBUTE_TAG_INFO attributes{};
  BY_HANDLE_FILE_INFORMATION node_identity{};
  if (!GetFileInformationByHandleEx(handle, FileIdInfo, &identity, sizeof(identity)) ||
      !GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &attributes,
                                    sizeof(attributes)) ||
      !GetFileInformationByHandle(handle, &node_identity)) {
    return false;
  }

  observation->directory = (attributes.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
  observation->reparse_point =
      (attributes.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
  observation->reparse_tag = observation->reparse_point ? attributes.ReparseTag : 0;
  observation->node_device = node_identity.dwVolumeSerialNumber;
  observation->node_inode =
      (static_cast<std::uint64_t>(node_identity.nFileIndexHigh) << 32) |
      node_identity.nFileIndexLow;
  observation->volume_serial_number = identity.VolumeSerialNumber;
  for (std::size_t index = 0; index < observation->file_id.size(); ++index) {
    observation->file_id[index] = identity.FileId.Identifier[index];
  }
  return true;
}

inline HANDLE OpenObservationHandle(const std::wstring& path) {
  const std::wstring extended_path = ExtendedLocalPath(path);
  return CreateFileW(extended_path.c_str(), FILE_READ_ATTRIBUTES,
                     FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                     OPEN_EXISTING,
                     FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
}

inline bool ObservePath(const std::wstring& path, Observation* observation) {
  HANDLE handle = OpenObservationHandle(path);
  if (handle == INVALID_HANDLE_VALUE) return false;
  const bool observed = ObserveHandle(handle, observation);
  const bool closed = CloseHandle(handle) != 0;
  return observed && closed;
}

}  // namespace orchestration_platform::windows_reparse

#endif
