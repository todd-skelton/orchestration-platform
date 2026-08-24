#!/usr/bin/python3
"""Stable-only Linux transient user/private-group helper for ISS-006."""

import grp
import json
import os
import pwd
import re
import spwd
import stat
import subprocess
import sys


MINIMUM_ID = 1_000_000
MAXIMUM_ID = 2_147_483_646
NAME_PATTERN = re.compile(r"orch6-[a-f0-9]{16}")
GROUPADD = "/usr/sbin/groupadd"
GROUPDEL = "/usr/sbin/groupdel"
NOLOGIN = "/usr/sbin/nologin"
USERADD = "/usr/sbin/useradd"
USERDEL = "/usr/sbin/userdel"


def canonical_id(value: str) -> int:
    if not value or not value.isascii() or not value.isdecimal():
        raise ValueError("identity:canonical-decimal-required")
    if value != "0" and value.startswith("0"):
        raise ValueError("identity:canonical-decimal-required")
    identity = int(value, 10)
    if identity < MINIMUM_ID or identity > MAXIMUM_ID:
        raise ValueError("identity:high-unprivileged-range-required")
    return identity


def canonical_stable_id(value: str) -> int:
    if not value or not value.isascii() or not value.isdecimal():
        raise ValueError("stable-identity:canonical-decimal-required")
    if value != "0" and value.startswith("0"):
        raise ValueError("stable-identity:canonical-decimal-required")
    identity = int(value, 10)
    if identity <= 0 or identity > MAXIMUM_ID:
        raise ValueError("stable-identity:unprivileged-range-required")
    return identity


def exact_name(value: str) -> str:
    if not NAME_PATTERN.fullmatch(value):
        raise ValueError("identity:name-refused")
    return value


def database_lookup(function, value):
    try:
        return function(value)
    except KeyError:
        return None


def account_state(name: str, uid: int, gid: int):
    return {
        "groupById": database_lookup(grp.getgrgid, gid),
        "groupByName": database_lookup(grp.getgrnam, name),
        "userById": database_lookup(pwd.getpwuid, uid),
        "userByName": database_lookup(pwd.getpwnam, name),
    }


def process_identity(pid: int):
    with open(f"/proc/{pid}/status", "r", encoding="ascii", errors="strict") as handle:
        selected = [
            line for line in handle if line.startswith("Uid:") or line.startswith("Gid:")
        ]
    if len(selected) != 2:
        raise RuntimeError("process:identity-row-census-refused")
    observed = {}
    for line in selected:
        fields = line.split()
        if len(fields) != 5 or fields[0] not in ("Uid:", "Gid:"):
            raise RuntimeError("process:identity-row-refused")
        values = fields[1:]
        if any(
            not value.isascii()
            or not value.isdecimal()
            or str(int(value, 10)) != value
            for value in values
        ):
            raise RuntimeError("process:identity-value-refused")
        observed[fields[0]] = tuple(int(value, 10) for value in values)
    if set(observed) != {"Uid:", "Gid:"}:
        raise RuntimeError("process:identity-kind-census-refused")
    return observed["Uid:"], observed["Gid:"]


def process_identity_rows():
    rows = []
    with os.scandir("/proc") as entries:
        for entry in entries:
            if not entry.name.isascii() or not entry.name.isdecimal():
                continue
            try:
                rows.append(process_identity(int(entry.name, 10)))
            except FileNotFoundError:
                continue
    return tuple(rows)


def require_no_process_identity(uid: int, gid: int):
    for uids, gids in process_identity_rows():
        if uid in uids or gid in gids:
            raise RuntimeError("identity:process-residue")


def require_absent(name: str, uid: int, gid: int):
    if any(value is not None for value in account_state(name, uid, gid).values()):
        raise RuntimeError("identity:database-residue")
    require_no_process_identity(uid, gid)


def command(arguments):
    executable = arguments[0]
    before = helper_identity(executable)
    result = subprocess.run(
        arguments,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if helper_identity(executable) != before:
        raise RuntimeError("identity:helper-moved")
    if result.returncode != 0 or result.stdout != b"" or result.stderr != b"":
        raise RuntimeError("identity:command-refused")


def helper_identity(path: str):
    identity = os.lstat(path)
    if (
        not stat.S_ISREG(identity.st_mode)
        or stat.S_ISLNK(identity.st_mode)
        or identity.st_uid != 0
        or stat.S_IMODE(identity.st_mode) & 0o022
    ):
        raise RuntimeError("identity:helper-profile-refused")
    return (
        identity.st_dev,
        identity.st_ino,
        identity.st_mode,
        identity.st_uid,
        identity.st_gid,
    )


def require_created(name: str, uid: int, gid: int, stable_uid: int, stable_gid: int):
    state = account_state(name, uid, gid)
    user = state["userByName"]
    group = state["groupByName"]
    if (
        user is None
        or group is None
        or state["userById"] != user
        or state["groupById"] != group
        or user.pw_name != name
        or user.pw_uid != uid
        or user.pw_gid != gid
        or user.pw_shell != NOLOGIN
        or group.gr_name != name
        or group.gr_gid != gid
        or tuple(group.gr_mem) != ()
        or not locked_password(name)
        or uid == stable_uid
        or gid == stable_gid
    ):
        raise RuntimeError("identity:created-state-refused")
    if tuple(sorted(set(os.getgrouplist(name, gid)))) != (gid,):
        raise RuntimeError("identity:supplementary-group-refused")
    primary_members = tuple(sorted(row.pw_name for row in pwd.getpwall() if row.pw_gid == gid))
    if primary_members != (name,):
        raise RuntimeError("identity:private-group-refused")


def locked_password(name: str) -> bool:
    shadow = spwd.getspnam(name)
    return bool(shadow.sp_pwdp) and shadow.sp_pwdp[0] in ("!", "*")


def remove_expected(name: str, uid: int, gid: int):
    issues = []
    state = account_state(name, uid, gid)
    users = tuple(
        {id(user): user for user in (state["userByName"], state["userById"]) if user is not None}.values()
    )
    if users:
        if any(user.pw_name != name or user.pw_uid != uid or user.pw_gid != gid for user in users):
            issues.append("identity:user-collision")
        else:
            try:
                command([USERDEL, name])
            except BaseException:
                issues.append("identity:user-delete-refused")
    state = account_state(name, uid, gid)
    groups = tuple(
        {id(group): group for group in (state["groupByName"], state["groupById"]) if group is not None}.values()
    )
    if groups:
        if any(group.gr_name != name or group.gr_gid != gid for group in groups):
            issues.append("identity:group-collision")
        else:
            try:
                command([GROUPDEL, name])
            except BaseException:
                issues.append("identity:group-delete-refused")
    try:
        require_absent(name, uid, gid)
    except BaseException:
        issues.append("identity:absence-refused")
    if issues:
        raise RuntimeError(",".join(sorted(set(issues))))


def create(name: str, uid: int, gid: int, stable_uid: int, stable_gid: int):
    require_absent(name, uid, gid)
    if stable_uid == 0 or stable_gid == 0:
        raise RuntimeError("identity:stable-root-refused")
    try:
        command(
            [
                GROUPADD,
                "-K",
                f"GID_MIN={gid}",
                "-K",
                f"GID_MAX={gid}",
                "--gid",
                str(gid),
                name,
            ]
        )
        command(
            [
                USERADD,
                "-K",
                f"UID_MIN={uid}",
                "-K",
                f"UID_MAX={uid}",
                "--uid",
                str(uid),
                "--gid",
                str(gid),
                "--no-user-group",
                "--no-log-init",
                "--no-create-home",
                "--shell",
                NOLOGIN,
                name,
            ]
        )
        require_created(name, uid, gid, stable_uid, stable_gid)
        require_no_process_identity(uid, gid)
    except BaseException:
        remove_expected(name, uid, gid)
        raise
    sys.stdout.write(
        json.dumps(
            {"gid": str(gid), "name": name, "uid": str(uid)},
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )
    )
    sys.stdout.flush()


def delete(name: str, uid: int, gid: int):
    require_no_process_identity(uid, gid)
    remove_expected(name, uid, gid)
    sys.stdout.write('{"ok":true}')
    sys.stdout.flush()


def main():
    helper_uids, helper_gids = process_identity(os.getpid())
    if (
        sys.platform != "linux"
        or helper_uids != (0, 0, 0, 0)
        or helper_gids != (0, 0, 0, 0)
    ):
        raise RuntimeError("helper:root-linux-required")
    if len(sys.argv) == 7 and sys.argv[1] == "CREATE":
        create(
            exact_name(sys.argv[2]),
            canonical_id(sys.argv[3]),
            canonical_id(sys.argv[4]),
            canonical_stable_id(sys.argv[5]),
            canonical_stable_id(sys.argv[6]),
        )
        return
    if len(sys.argv) == 5 and sys.argv[1] == "DELETE":
        delete(exact_name(sys.argv[2]), canonical_id(sys.argv[3]), canonical_id(sys.argv[4]))
        return
    raise ValueError("argv:operation-refused")


if __name__ == "__main__":
    main()
