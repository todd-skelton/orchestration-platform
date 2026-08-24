#!/usr/bin/python3
"""Stable-only fd-relative Linux execution-root cleanup helper for ISS-006."""

import hashlib
import json
import os
import posixpath
import stat
import sys


FIELDS = (
    "ancestors",
    "candidate",
    "executionName",
    "mode",
    "root",
    "rpcRunner",
    "scratch",
    "stableGid",
    "stableUid",
)
IDENTITY_FIELDS = ("device", "digest", "gid", "inode", "mode", "path", "size", "type", "uid")
MAXIMUM_ID = 2_147_483_646


def closed_object(pairs):
    value = {}
    for key, observed in pairs:
        if key in value:
            raise ValueError("request:duplicate-field-refused")
        value[key] = observed
    return value


def decimal(value, maximum=2**63 - 1):
    if not isinstance(value, str) or not value.isascii() or not value.isdecimal():
        raise ValueError("value:canonical-decimal-required")
    if value != "0" and value.startswith("0"):
        raise ValueError("value:canonical-decimal-required")
    number = int(value, 10)
    if number < 0 or number > maximum:
        raise ValueError("value:range-refused")
    return number


def identity(value, kind):
    if not isinstance(value, dict) or tuple(sorted(value)) != tuple(sorted(IDENTITY_FIELDS)):
        raise ValueError("identity:field-census-refused")
    if value["type"] != kind or not isinstance(value["path"], str) or not posixpath.isabs(value["path"]) or posixpath.normpath(value["path"]) != value["path"]:
        raise ValueError("identity:path-type-refused")
    digest = value["digest"]
    if not (digest is None or isinstance(digest, str) and len(digest) == 64 and all(character in "0123456789abcdef" for character in digest)):
        raise ValueError("identity:digest-refused")
    return {
        "device": decimal(value["device"]),
        "digest": digest,
        "gid": decimal(value["gid"], MAXIMUM_ID),
        "inode": decimal(value["inode"]),
        "mode": decimal(value["mode"], 0o7777),
        "path": value["path"],
        "size": decimal(value["size"]),
        "type": kind,
        "uid": decimal(value["uid"], MAXIMUM_ID),
    }


def read_request():
    payload = sys.stdin.buffer.read(65_537)
    if not payload or len(payload) > 65_536:
        raise ValueError("request:length-refused")
    value = json.loads(payload.decode("utf-8", errors="strict"), object_pairs_hook=closed_object)
    if not isinstance(value, dict) or tuple(sorted(value)) != tuple(sorted(FIELDS)):
        raise ValueError("request:field-census-refused")
    mode = value["mode"]
    if mode not in ("PARTIAL", "CREATED"):
        raise ValueError("request:mode-refused")
    if not isinstance(value["executionName"], str) or not value["executionName"].startswith("orch6-exec-") or len(value["executionName"]) != len("orch6-exec-") + 16:
        raise ValueError("request:name-refused")
    token = value["executionName"][len("orch6-exec-"):]
    if any(character not in "0123456789abcdef" for character in token):
        raise ValueError("request:name-refused")
    if not isinstance(value["ancestors"], list) or not 1 <= len(value["ancestors"]) <= 256:
        raise ValueError("request:ancestor-census-refused")
    ancestors = [identity(item, "DIRECTORY") for item in value["ancestors"]]
    stable_uid = decimal(value["stableUid"], MAXIMUM_ID)
    stable_gid = decimal(value["stableGid"], MAXIMUM_ID)
    if stable_uid == 0 or stable_gid == 0:
        raise ValueError("request:stable-unprivileged-refused")
    expected_paths = ["/"]
    current = "/"
    parent_path = ancestors[-1]["path"]
    for component in parent_path.split("/")[1:]:
        if component:
            current = posixpath.join(current, component)
            expected_paths.append(current)
    if [item["path"] for item in ancestors] != expected_paths:
        raise ValueError("request:ancestor-chain-refused")
    expected_root_path = posixpath.join(parent_path, value["executionName"])
    parsed = {
        "ancestors": ancestors,
        "candidate": None if value["candidate"] is None else identity(value["candidate"], "FILE"),
        "executionName": value["executionName"],
        "mode": mode,
        "root": None if value["root"] is None else identity(value["root"], "DIRECTORY"),
        "rpcRunner": None if value["rpcRunner"] is None else identity(value["rpcRunner"], "FILE"),
        "scratch": None if value["scratch"] is None else identity(value["scratch"], "DIRECTORY"),
        "stableGid": stable_gid,
        "stableUid": stable_uid,
    }
    if mode == "PARTIAL":
        if any(parsed[field] is not None for field in ("candidate", "root", "rpcRunner", "scratch")):
            raise ValueError("request:partial-identity-refused")
    else:
        if any(parsed[field] is None for field in ("candidate", "root", "rpcRunner", "scratch")):
            raise ValueError("request:created-identity-required")
        for field, name in (("candidate", "candidate.mjs"), ("rpcRunner", "rpc-runner.mjs"), ("scratch", "scratch")):
            if parsed[field]["path"] != posixpath.join(expected_root_path, name):
                raise ValueError("request:child-path-refused")
        if parsed["root"]["path"] != expected_root_path:
            raise ValueError("request:root-path-refused")
    objects = list(ancestors)
    if mode == "CREATED":
        objects.extend(parsed[field] for field in ("root", "candidate", "rpcRunner", "scratch"))
    keys = [(item["device"], item["inode"]) for item in objects]
    if len(set(keys)) != len(keys):
        raise ValueError("request:object-alias-refused")
    return parsed


def observed(handle, path, kind, digest=False):
    profile = os.fstat(handle)
    if kind == "FILE" and not stat.S_ISREG(profile.st_mode):
        raise RuntimeError("identity:file-required")
    if kind == "DIRECTORY" and not stat.S_ISDIR(profile.st_mode):
        raise RuntimeError("identity:directory-required")
    value = {
        "device": profile.st_dev,
        "digest": None,
        "gid": profile.st_gid,
        "inode": profile.st_ino,
        "mode": stat.S_IMODE(profile.st_mode),
        "path": path,
        "size": 0 if kind == "DIRECTORY" else profile.st_size,
        "type": kind,
        "uid": profile.st_uid,
    }
    if digest:
        hasher = hashlib.sha256()
        os.lseek(handle, 0, os.SEEK_SET)
        while True:
            chunk = os.read(handle, 1024 * 1024)
            if not chunk:
                break
            hasher.update(chunk)
        value["digest"] = hasher.hexdigest()
    return value


def require_exact(handle, expected, digest=False):
    if observed(handle, expected["path"], expected["type"], digest) != expected:
        raise RuntimeError("identity:mismatch")


def open_ancestors(request):
    handles = []
    try:
        for index, expected in enumerate(request["ancestors"]):
            handle = os.open(
                "/" if index == 0 else posixpath.basename(expected["path"]),
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                **({} if index == 0 else {"dir_fd": handles[-1]}),
            )
            require_exact(handle, expected)
            handles.append(handle)
        return handles
    except BaseException:
        for handle in reversed(handles):
            os.close(handle)
        raise


def require_chain(handles, request):
    for index, expected in enumerate(request["ancestors"]):
        require_exact(handles[index], expected)
        if index:
            probe = os.open(posixpath.basename(expected["path"]), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=handles[index - 1])
            try:
                require_exact(probe, expected)
            finally:
                os.close(probe)


def require_entry(parent, name, retained, expected, kind, digest=False):
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | (os.O_DIRECTORY if kind == "DIRECTORY" else 0)
    probe = os.open(name, flags, dir_fd=parent)
    try:
        require_exact(retained, expected, digest)
        require_exact(probe, expected, digest)
    finally:
        os.close(probe)


def close_all(handles):
    issues = []
    for handle in handles:
        try:
            os.close(handle)
        except BaseException:
            issues.append(handle)
    if issues:
        raise RuntimeError("identity:descriptor-close-refused")


def main():
    if sys.platform != "linux" or os.getuid() == 0 or os.getgid() == 0:
        raise RuntimeError("helper:stable-unprivileged-linux-required")
    if len(sys.argv) != 1:
        raise ValueError("argv:stdin-only-required")
    request = read_request()
    if os.getuid() != request["stableUid"] or os.getgid() != request["stableGid"]:
        raise RuntimeError("helper:stable-identity-refused")
    ancestors = open_ancestors(request)
    root = None
    children = {}
    try:
        parent = ancestors[-1]
        try:
            root = os.open(request["executionName"], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        except FileNotFoundError:
            sys.stdout.write('{"ok":true}')
            return
        entries = tuple(sorted(os.listdir(root)))
        if any(name not in ("candidate.mjs", "rpc-runner.mjs", "scratch") for name in entries):
            raise RuntimeError("identity:root-census-refused")
        if request["mode"] == "CREATED" and not all(name in entries for name in ("candidate.mjs", "rpc-runner.mjs")):
            raise RuntimeError("identity:created-census-refused")
        if request["mode"] == "CREATED":
            require_exact(root, request["root"])
        else:
            profile = os.fstat(root)
            if profile.st_uid != request["stableUid"] or profile.st_gid != request["stableGid"] or stat.S_IMODE(profile.st_mode) != 0o700:
                raise RuntimeError("identity:partial-root-profile-refused")
        for field, name, kind in (("candidate", "candidate.mjs", "FILE"), ("rpcRunner", "rpc-runner.mjs", "FILE"), ("scratch", "scratch", "DIRECTORY")):
            if name not in entries:
                continue
            flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | (os.O_DIRECTORY if kind == "DIRECTORY" else 0)
            handle = os.open(name, flags, dir_fd=root)
            children[field] = handle
            if request["mode"] == "CREATED":
                require_exact(handle, request[field], kind == "FILE")
            else:
                profile = os.fstat(handle)
                expected_mode = 0o600 if kind == "FILE" else 0o700
                if profile.st_uid != request["stableUid"] or profile.st_gid != request["stableGid"] or stat.S_IMODE(profile.st_mode) != expected_mode:
                    raise RuntimeError("identity:partial-child-profile-refused")
        if "scratch" in children and os.listdir(children["scratch"]):
            raise RuntimeError("identity:scratch-nonempty-refused")
        require_chain(ancestors, request)
        for field in ("candidate", "rpcRunner"):
            if field in children:
                name = "candidate.mjs" if field == "candidate" else "rpc-runner.mjs"
                expected = request[field] if request["mode"] == "CREATED" else observed(children[field], posixpath.join(request["ancestors"][-1]["path"], request["executionName"], name), "FILE")
                require_entry(root, name, children[field], expected, "FILE", request["mode"] == "CREATED")
                os.unlink(name, dir_fd=root)
        if "scratch" in children:
            expected = request["scratch"] if request["mode"] == "CREATED" else observed(children["scratch"], posixpath.join(request["ancestors"][-1]["path"], request["executionName"], "scratch"), "DIRECTORY")
            require_entry(root, "scratch", children["scratch"], expected, "DIRECTORY")
            os.rmdir("scratch", dir_fd=root)
        if os.listdir(root):
            raise RuntimeError("identity:root-residue")
        require_chain(ancestors, request)
        root_expected = request["root"] if request["mode"] == "CREATED" else observed(root, posixpath.join(request["ancestors"][-1]["path"], request["executionName"]), "DIRECTORY")
        require_entry(parent, request["executionName"], root, root_expected, "DIRECTORY")
        os.rmdir(request["executionName"], dir_fd=parent)
        try:
            os.stat(request["executionName"], dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise RuntimeError("identity:root-removal-refused")
        sys.stdout.write('{"ok":true}')
        sys.stdout.flush()
    finally:
        close_all([*children.values(), *([] if root is None else [root]), *reversed(ancestors)])


if __name__ == "__main__":
    main()
