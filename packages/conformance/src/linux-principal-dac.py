#!/usr/bin/python3
"""Stable-only Linux POSIX DAC transition helper for ISS-006."""

import json
import os
import posixpath
import shutil
import stat
import sys


MINIMUM_ID = 1_000_000
MAXIMUM_ID = 2_147_483_646
ENTRY_NAMES = ("candidate.mjs", "rpc-runner.mjs", "scratch")
IDENTITY_FIELDS = ("device", "gid", "inode", "mode", "path", "type", "uid")
REQUEST_FIELDS = (
    "ancestors",
    "candidate",
    "gid",
    "operation",
    "parent",
    "root",
    "rpcRunner",
    "scratch",
    "stableGid",
    "stableUid",
    "uid",
)


def canonical_decimal(value, minimum=0, maximum=MAXIMUM_ID):
    if not isinstance(value, str) or not value.isascii() or not value.isdecimal():
        raise ValueError("value:canonical-decimal-required")
    if value != "0" and value.startswith("0"):
        raise ValueError("value:canonical-decimal-required")
    number = int(value, 10)
    if number < minimum or number > maximum:
        raise ValueError("value:range-refused")
    return number


def exact_identity(value, kind):
    if not isinstance(value, dict) or tuple(sorted(value)) != tuple(sorted(IDENTITY_FIELDS)):
        raise ValueError("identity:field-census-refused")
    if value["type"] != kind or not isinstance(value["path"], str) or not os.path.isabs(value["path"]):
        raise ValueError("identity:path-or-type-refused")
    return {
        "device": canonical_decimal(value["device"], maximum=2**63 - 1),
        "gid": canonical_decimal(value["gid"]),
        "inode": canonical_decimal(value["inode"], maximum=2**63 - 1),
        "mode": canonical_decimal(value["mode"], maximum=0o7777),
        "path": value["path"],
        "type": kind,
        "uid": canonical_decimal(value["uid"]),
    }


def closed_object(pairs):
    value = {}
    for key, observed in pairs:
        if key in value:
            raise ValueError("request:duplicate-field-refused")
        value[key] = observed
    return value


def read_request():
    payload = sys.stdin.buffer.read(65_537)
    if not payload or len(payload) > 65_536:
        raise ValueError("request:length-refused")
    value = json.loads(payload.decode("utf-8", errors="strict"), object_pairs_hook=closed_object)
    if not isinstance(value, dict) or tuple(sorted(value)) != tuple(sorted(REQUEST_FIELDS)):
        raise ValueError("request:field-census-refused")
    operation = value["operation"]
    if operation not in ("PREPARE", "RESTORE"):
        raise ValueError("request:operation-refused")
    request = {
        "ancestors": value["ancestors"],
        "candidate": exact_identity(value["candidate"], "FILE"),
        "gid": canonical_decimal(value["gid"], MINIMUM_ID),
        "operation": operation,
        "parent": exact_identity(value["parent"], "DIRECTORY"),
        "root": exact_identity(value["root"], "DIRECTORY"),
        "rpcRunner": exact_identity(value["rpcRunner"], "FILE"),
        "scratch": exact_identity(value["scratch"], "DIRECTORY"),
        "stableGid": canonical_decimal(value["stableGid"], 1),
        "stableUid": canonical_decimal(value["stableUid"], 1),
        "uid": canonical_decimal(value["uid"], MINIMUM_ID),
    }
    if not isinstance(request["ancestors"], list) or not 1 <= len(request["ancestors"]) <= 256:
        raise ValueError("request:ancestor-census-refused")
    request["ancestors"] = [
        exact_identity(ancestor, "DIRECTORY") for ancestor in request["ancestors"]
    ]
    if request["uid"] == request["stableUid"] or request["gid"] == request["stableGid"]:
        raise ValueError("request:principal-equality-refused")
    expected_paths = [posixpath.sep]
    current = posixpath.sep
    for component in request["parent"]["path"].split(posixpath.sep)[1:]:
        if component:
            current = posixpath.join(current, component)
            expected_paths.append(current)
    if [ancestor["path"] for ancestor in request["ancestors"]] != expected_paths:
        raise ValueError("request:ancestor-chain-refused")
    if request["ancestors"][-1] != request["parent"]:
        raise ValueError("request:ancestor-parent-refused")
    object_keys = [
        (ancestor["device"], ancestor["inode"]) for ancestor in request["ancestors"]
    ] + [
        (request[field]["device"], request[field]["inode"])
        for field in ("root", "candidate", "rpcRunner", "scratch")
    ]
    if len(set(object_keys)) != len(object_keys):
        raise ValueError("request:object-alias-refused")
    return request


def process_identity(pid):
    with open(f"/proc/{pid}/status", "r", encoding="ascii", errors="strict") as handle:
        rows = [line for line in handle if line.startswith("Uid:") or line.startswith("Gid:")]
    if len(rows) != 2:
        raise RuntimeError("helper:identity-row-census-refused")
    observed = {}
    for row in rows:
        fields = row.split()
        if len(fields) != 5 or fields[0] not in ("Uid:", "Gid:"):
            raise RuntimeError("helper:identity-row-refused")
        values = fields[1:]
        if any(not value.isascii() or not value.isdecimal() for value in values):
            raise RuntimeError("helper:identity-value-refused")
        observed[fields[0]] = tuple(int(value, 10) for value in values)
    return observed["Uid:"], observed["Gid:"]


def identity(identity_stat, path, kind):
    if kind == "FILE" and not stat.S_ISREG(identity_stat.st_mode):
        raise RuntimeError("identity:regular-file-required")
    if kind == "DIRECTORY" and not stat.S_ISDIR(identity_stat.st_mode):
        raise RuntimeError("identity:regular-directory-required")
    return {
        "device": identity_stat.st_dev,
        "gid": identity_stat.st_gid,
        "inode": identity_stat.st_ino,
        "mode": stat.S_IMODE(identity_stat.st_mode),
        "path": path,
        "type": kind,
        "uid": identity_stat.st_uid,
    }


def require_identity(handle, expected):
    if identity(os.fstat(handle), expected["path"], expected["type"]) != expected:
        raise RuntimeError("identity:mismatch")


def require_immutable_identity(handle, expected):
    observed = identity(os.fstat(handle), expected["path"], expected["type"])
    for field in ("device", "inode", "path", "type"):
        if observed[field] != expected[field]:
            raise RuntimeError("identity:immutable-mismatch")


def expected_profile(original, uid, gid, mode):
    return {**original, "uid": uid, "gid": gid, "mode": mode}


def open_handles(request):
    parent_path = request["parent"]["path"]
    root_path = request["root"]["path"]
    if (
        os.path.realpath(parent_path) != parent_path
        or os.path.realpath(root_path) != root_path
        or os.path.dirname(root_path) != parent_path
    ):
        raise RuntimeError("identity:root-hierarchy-refused")
    ancestor_handles = []
    handles = {}
    try:
        for index, expected in enumerate(request["ancestors"]):
            if index == 0:
                handle = os.open(
                    os.path.sep,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                )
            else:
                handle = os.open(
                    os.path.basename(expected["path"]),
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                    dir_fd=ancestor_handles[-1],
                )
            require_identity(handle, expected)
            ancestor_handles.append(handle)
        parent = ancestor_handles[-1]
        handles["parent"] = parent
        root = os.open(
            os.path.basename(root_path),
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=parent,
        )
        handles["root"] = root
        observed_entries = tuple(sorted(os.listdir(root)))
        admitted_entries = [tuple(sorted(ENTRY_NAMES))]
        if request["operation"] == "RESTORE":
            admitted_entries.append(("candidate.mjs", "rpc-runner.mjs"))
        if observed_entries not in admitted_entries:
            raise RuntimeError("identity:root-census-refused")
        for field, name, flags in [
            ("candidate", "candidate.mjs", os.O_RDONLY),
            ("rpcRunner", "rpc-runner.mjs", os.O_RDONLY),
            *(
                [("scratch", "scratch", os.O_RDONLY | os.O_DIRECTORY)]
                if "scratch" in observed_entries
                else []
            ),
        ]:
            if request[field]["path"] != os.path.join(root_path, name):
                raise RuntimeError("identity:child-hierarchy-refused")
            handles[field] = os.open(name, flags | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=root)
        for field, handle in handles.items():
            require_immutable_identity(handle, request[field])
        return handles, ancestor_handles
    except BaseException:
        for field in ("scratch", "rpcRunner", "candidate", "root"):
            if field in handles:
                os.close(handles[field])
        for handle in reversed(ancestor_handles):
            os.close(handle)
        raise


def require_ancestor_custody(ancestor_handles, request):
    if len(ancestor_handles) != len(request["ancestors"]):
        raise RuntimeError("identity:ancestor-handle-census-refused")
    for index, (handle, expected) in enumerate(
        zip(ancestor_handles, request["ancestors"], strict=True)
    ):
        require_identity(handle, expected)
        if index > 0:
            probe = os.open(
                posixpath.basename(expected["path"]),
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=ancestor_handles[index - 1],
            )
            try:
                require_identity(probe, expected)
            finally:
                os.close(probe)


def set_profile(handle, expected):
    os.fchown(handle, expected["uid"], expected["gid"])
    os.fchmod(handle, expected["mode"])
    require_identity(handle, expected)


def original_profiles(request):
    stable_uid = request["stableUid"]
    stable_gid = request["stableGid"]
    expected = {
        "parent": expected_profile(request["parent"], stable_uid, stable_gid, 0o700),
        "root": expected_profile(request["root"], stable_uid, stable_gid, 0o700),
        "candidate": expected_profile(request["candidate"], stable_uid, stable_gid, 0o600),
        "rpcRunner": expected_profile(request["rpcRunner"], stable_uid, stable_gid, 0o600),
        "scratch": expected_profile(request["scratch"], stable_uid, stable_gid, 0o700),
    }
    if any(request[field] != profile for field, profile in expected.items()):
        raise RuntimeError("identity:original-profile-refused")
    devices = {profile["device"] for profile in expected.values()}
    if len(devices) != 1:
        raise RuntimeError("identity:device-relation-refused")
    return expected


def granted_profiles(request):
    return {
        "parent": request["parent"],
        "root": expected_profile(request["root"], 0, request["gid"], 0o510),
        "candidate": expected_profile(request["candidate"], 0, request["gid"], 0o550),
        "rpcRunner": expected_profile(request["rpcRunner"], 0, request["gid"], 0o550),
        "scratch": expected_profile(request["scratch"], request["uid"], request["gid"], 0o700),
    }


def restore_all(handles, originals):
    issues = []
    for field in ("root", "candidate", "rpcRunner", "scratch"):
        try:
            set_profile(handles[field], originals[field])
        except BaseException:
            issues.append(f"identity:{field}-restore-refused")
    try:
        require_identity(handles["parent"], originals["parent"])
    except BaseException:
        issues.append("identity:parent-moved")
    if issues:
        raise RuntimeError(",".join(sorted(issues)))


def prepare(request, handles, originals):
    granted = granted_profiles(request)
    try:
        for field in ("candidate", "rpcRunner", "scratch", "root"):
            set_profile(handles[field], granted[field])
        require_identity(handles["parent"], originals["parent"])
    except BaseException:
        restore_all(handles, originals)
        raise


def restore(request, handles, originals):
    granted = granted_profiles(request)
    issues = []
    for field in ("parent", "root", "candidate", "rpcRunner"):
        observed = identity(os.fstat(handles[field]), originals[field]["path"], originals[field]["type"])
        if field == "parent":
            if observed != originals[field]:
                issues.append("identity:parent-profile-refused")
            continue
        if observed == originals[field]:
            continue
        if observed != granted[field]:
            issues.append(f"identity:{field}-profile-refused")
        try:
            set_profile(handles[field], originals[field])
        except BaseException:
            issues.append(f"identity:{field}-restore-refused")
    if "scratch" in handles:
        try:
            scratch = identity(
                os.fstat(handles["scratch"]), originals["scratch"]["path"], "DIRECTORY"
            )
            if scratch != originals["scratch"]:
                if scratch["uid"] != request["uid"] or scratch["gid"] != request["gid"]:
                    issues.append("identity:scratch-profile-refused")
                set_profile(handles["scratch"], originals["scratch"])
        except BaseException:
            issues.append("identity:scratch-restore-refused")
    return issues


def require_single_device_tree(root_handle, device):
    if os.fstat(root_handle).st_dev != device:
        raise RuntimeError("identity:scratch-device-refused")
    for _, directories, files, current_handle in os.fwalk(
        ".", topdown=True, follow_symlinks=False, dir_fd=root_handle
    ):
        for name in tuple(directories) + tuple(files):
            observed = os.stat(name, dir_fd=current_handle, follow_symlinks=False)
            if observed.st_dev != device:
                raise RuntimeError("identity:scratch-mount-refused")


def require_scratch_entry(root_handle, scratch_handle, original):
    require_identity(scratch_handle, original)
    scratch_entry = os.stat("scratch", dir_fd=root_handle, follow_symlinks=False)
    if identity(scratch_entry, original["path"], "DIRECTORY") != original:
        raise RuntimeError("identity:scratch-entry-moved")


def main():
    helper_uids, helper_gids = process_identity(os.getpid())
    if sys.platform != "linux" or helper_uids != (0, 0, 0, 0) or helper_gids != (0, 0, 0, 0):
        raise RuntimeError("helper:root-linux-required")
    if len(sys.argv) != 1:
        raise ValueError("argv:stdin-only-required")
    if not shutil.rmtree.avoids_symlink_attacks:
        raise RuntimeError("helper:fd-cleanup-unsupported")
    request = read_request()
    originals = original_profiles(request)
    handles, ancestor_handles = open_handles(request)
    restore_issues = []
    try:
        if request["operation"] == "PREPARE":
            for field, handle in handles.items():
                require_identity(handle, originals[field])
            prepare(request, handles, originals)
        else:
            restore_issues = restore(request, handles, originals)
        require_ancestor_custody(ancestor_handles, request)
        if request["operation"] == "RESTORE":
            try:
                require_identity(handles["root"], originals["root"])
            except BaseException:
                restore_issues.append("identity:root-revocation-refused")
            else:
                if "scratch" in handles:
                    require_scratch_entry(
                        handles["root"], handles["scratch"], originals["scratch"]
                    )
                    require_single_device_tree(
                        handles["scratch"], request["root"]["device"]
                    )
                    shutil.rmtree("scratch", dir_fd=handles["root"])
                try:
                    os.stat("scratch", dir_fd=handles["root"], follow_symlinks=False)
                except FileNotFoundError:
                    pass
                else:
                    raise RuntimeError("identity:scratch-residue")
                if tuple(sorted(os.listdir(handles["root"]))) != (
                    "candidate.mjs",
                    "rpc-runner.mjs",
                ):
                    raise RuntimeError("identity:restored-census-refused")
            require_ancestor_custody(ancestor_handles, request)
            if restore_issues:
                raise RuntimeError(",".join(sorted(set(restore_issues))))
        sys.stdout.write('{"ok":true}')
        sys.stdout.flush()
    finally:
        for field in ("scratch", "rpcRunner", "candidate", "root"):
            if field in handles:
                os.close(handles[field])
        for handle in reversed(ancestor_handles):
            os.close(handle)


if __name__ == "__main__":
    main()
