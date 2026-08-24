#define setgroups fixture_setgroups
#define setgid fixture_setgid
#define setuid fixture_setuid
#define getuid fixture_getuid
#define geteuid fixture_geteuid
#define getgid fixture_getgid
#define getegid fixture_getegid
#define getgroups fixture_getgroups
#define kill fixture_kill
#define sysctl fixture_sysctl
#define chdir fixture_chdir
#define execve fixture_execve
#define _exit fixture_exit
#define main helper_main
#include "../../packages/conformance/src/macos-principal-helper.c"
#undef main
#undef _exit
#undef execve
#undef chdir
#undef sysctl
#undef kill
#undef getgroups
#undef getegid
#undef getgid
#undef geteuid
#undef getuid
#undef setuid
#undef setgid
#undef setgroups

#include <setjmp.h>

#define CHECK(value) do { if (!(value)) return __LINE__; } while (0)

static jmp_buf jump_target;
static char call_log[128];
static size_t call_log_length;
static uid_t observed_real_uid;
static uid_t observed_effective_uid;
static gid_t observed_real_gid;
static gid_t observed_effective_gid;
static int groups_count;
static int fail_setgroups;
static int fail_setgid;
static int fail_setuid;
static int bad_effective_uid;
static int corrupt_drop_field;
static int corrupt_after_regain_field;
static int chdir_result;
static int execve_returns;
static int regain_uid_errno = EPERM;
static int regain_gid_errno = EPERM;
static int regain_uid_success;
static int regain_gid_success;
static int kill_result;
static int kill_errno;
static int sysctl_mode;
static int sysctl_calls;
static struct kinfo_proc census_rows[MAXIMUM_CENSUS + 1];
static size_t census_rows_count;
static const char *captured_cwd;
static const char *captured_exec_path;
static const char *captured_exec_arguments[7];
static int captured_empty_environment;

static void log_call(char value) {
  if (call_log_length + 1 >= sizeof(call_log)) abort();
  call_log[call_log_length++] = value;
  call_log[call_log_length] = '\0';
}

static void reset_fixture(void) {
  memset(call_log, 0, sizeof(call_log));
  call_log_length = 0;
  observed_real_uid = 0;
  observed_effective_uid = 0;
  observed_real_gid = 0;
  observed_effective_gid = 0;
  groups_count = 0;
  fail_setgroups = 0;
  fail_setgid = 0;
  fail_setuid = 0;
  bad_effective_uid = 0;
  corrupt_drop_field = 0;
  corrupt_after_regain_field = 0;
  chdir_result = 0;
  execve_returns = 0;
  regain_uid_errno = EPERM;
  regain_gid_errno = EPERM;
  regain_uid_success = 0;
  regain_gid_success = 0;
  kill_result = 0;
  kill_errno = 0;
  sysctl_mode = 0;
  sysctl_calls = 0;
  memset(census_rows, 0, sizeof(census_rows));
  census_rows_count = 0;
  captured_cwd = NULL;
  captured_exec_path = NULL;
  memset(captured_exec_arguments, 0, sizeof(captured_exec_arguments));
  captured_empty_environment = 0;
}

int fixture_setgroups(int count, const gid_t *groups) {
  (void)groups;
  log_call('G');
  if (fail_setgroups) return -1;
  return count == 0 ? 0 : -1;
}

int fixture_setgid(gid_t gid) {
  log_call(gid == 0 ? 'R' : 'g');
  if (gid == 0) {
    if (regain_gid_success) return 0;
    if (corrupt_after_regain_field == 3) observed_real_gid = 0;
    if (corrupt_after_regain_field == 4) observed_effective_gid = 0;
    errno = regain_gid_errno;
    return -1;
  }
  if (fail_setgid) return -1;
  observed_real_gid = corrupt_drop_field == 3 ? gid + 1 : gid;
  observed_effective_gid = corrupt_drop_field == 4 ? gid + 1 : gid;
  return 0;
}

int fixture_setuid(uid_t uid) {
  log_call(uid == 0 ? 'U' : 'u');
  if (uid == 0) {
    if (regain_uid_success) return 0;
    if (corrupt_after_regain_field == 1) observed_real_uid = 0;
    if (corrupt_after_regain_field == 2) observed_effective_uid = 0;
    errno = regain_uid_errno;
    return -1;
  }
  if (fail_setuid) return -1;
  observed_real_uid = corrupt_drop_field == 1 ? uid + 1 : uid;
  observed_effective_uid = corrupt_drop_field == 2 ? uid + 1 : uid;
  return 0;
}

uid_t fixture_getuid(void) { return observed_real_uid; }
uid_t fixture_geteuid(void) {
  return bad_effective_uid ? observed_effective_uid + 1 : observed_effective_uid;
}
gid_t fixture_getgid(void) { return observed_real_gid; }
gid_t fixture_getegid(void) { return observed_effective_gid; }

int fixture_getgroups(int count, gid_t *groups) {
  (void)count;
  (void)groups;
  log_call('L');
  return groups_count;
}

int fixture_kill(pid_t pid, int signal_value) {
  log_call('K');
  if (pid != -1 || signal_value != SIGKILL) abort();
  errno = kill_errno;
  return kill_result;
}

int fixture_chdir(const char *path) {
  log_call('D');
  captured_cwd = path;
  return chdir_result;
}

int fixture_execve(const char *path, char *const argv[], char *const environment[]) {
  size_t index;
  log_call('E');
  captured_exec_path = path;
  for (index = 0; index < 7; index += 1) captured_exec_arguments[index] = argv[index];
  captured_empty_environment = environment[0] == NULL;
  if (execve_returns) {
    errno = ENOENT;
    return -1;
  }
  longjmp(jump_target, 2);
}

void fixture_exit(int status) {
  (void)status;
  longjmp(jump_target, 1);
}

int fixture_sysctl(
  int *name,
  u_int name_length,
  void *old_value,
  size_t *old_length,
  void *new_value,
  size_t new_length
) {
  size_t bytes = census_rows_count * sizeof(struct kinfo_proc);
  (void)new_value;
  (void)new_length;
  log_call('S');
  sysctl_calls += 1;
  if (name_length != 3 || name[0] != CTL_KERN || name[1] != KERN_PROC ||
      name[2] != KERN_PROC_ALL)
    abort();
  if (sysctl_mode == 1 && sysctl_calls == 1) {
    errno = EIO;
    return -1;
  }
  if (old_value == NULL) {
    *old_length = sysctl_mode == 2 ? 0 : sysctl_mode == 3 ? bytes + 1 : bytes;
    return 0;
  }
  if (sysctl_mode == 4) {
    errno = ENOMEM;
    return -1;
  }
  if (*old_length < bytes) {
    errno = ENOMEM;
    return -1;
  }
  memcpy(old_value, census_rows, bytes);
  *old_length = sysctl_mode == 5 ? bytes - sizeof(struct kinfo_proc) :
    sysctl_mode == 6 ? 0 : bytes;
  return 0;
}

static int invoke(int argc, char **argv) {
  int jump = setjmp(jump_target);
  if (jump != 0) return jump;
  return helper_main(argc, argv) == 0 ? 0 : 3;
}

static char *capture_stdout(int argc, char **argv, int *result) {
  FILE *temporary = tmpfile();
  int saved = dup(STDOUT_FILENO);
  long length;
  char *bytes;
  if (temporary == NULL || saved < 0 || dup2(fileno(temporary), STDOUT_FILENO) < 0) abort();
  *result = invoke(argc, argv);
  (void)fflush(stdout);
  if (dup2(saved, STDOUT_FILENO) < 0) abort();
  (void)close(saved);
  if (fseek(temporary, 0, SEEK_END) != 0) abort();
  length = ftell(temporary);
  if (length < 0 || fseek(temporary, 0, SEEK_SET) != 0) abort();
  bytes = (char *)calloc((size_t)length + 1, 1);
  if (bytes == NULL || fread(bytes, 1, (size_t)length, temporary) != (size_t)length) abort();
  (void)fclose(temporary);
  return bytes;
}

static int test_closed_inputs(void) {
  char *unknown[] = {"helper", "UNKNOWN", "60001", "60001", NULL};
  char *leading_zero[] = {"helper", "KILL_UID", "060001", "60001", NULL};
  char *signed_id[] = {"helper", "KILL_UID", "+60001", "60001", NULL};
  char *spaced_id[] = {"helper", "KILL_UID", "60001 ", "60001", NULL};
  char *below[] = {"helper", "CENSUS_UID", "59999", NULL};
  char *above[] = {"helper", "CENSUS_UID", "65000", NULL};
  char *unequal[] = {"helper", "KILL_UID", "60001", "60002", NULL};
  char *census_extra[] = {"helper", "CENSUS_UID", "60001", "extra", NULL};
  char *kill_extra[] = {"helper", "KILL_UID", "60001", "60001", "extra", NULL};
  reset_fixture(); CHECK(invoke(4, unknown) == 1);
  reset_fixture(); CHECK(invoke(4, leading_zero) == 1);
  reset_fixture(); CHECK(invoke(4, signed_id) == 1);
  reset_fixture(); CHECK(invoke(4, spaced_id) == 1);
  reset_fixture(); CHECK(invoke(3, below) == 1);
  reset_fixture(); CHECK(invoke(3, above) == 1);
  reset_fixture(); CHECK(invoke(4, unequal) == 1);
  reset_fixture(); CHECK(invoke(4, census_extra) == 1);
  reset_fixture(); CHECK(invoke(5, kill_extra) == 1);
  return 0;
}

static int test_exec_and_credentials(void) {
  char *argv[] = {
    "helper", "EXEC", "60001", "60001", "/scratch", "/runtime", "/rpc", "file:///candidate", NULL
  };
  char *bad_cwd[] = {
    "helper", "EXEC", "60001", "60001", "scratch", "/runtime", "/rpc", "file:///candidate", NULL
  };
  char *bad_runtime[] = {
    "helper", "EXEC", "60001", "60001", "/scratch", "runtime", "/rpc", "file:///candidate", NULL
  };
  char *bad_rpc[] = {
    "helper", "EXEC", "60001", "60001", "/scratch", "/runtime", "rpc", "file:///candidate", NULL
  };
  char *bad_url[] = {
    "helper", "EXEC", "60001", "60001", "/scratch", "/runtime", "/rpc", "file:", NULL
  };
  char *bad_scheme[] = {
    "helper", "EXEC", "60001", "60001", "/scratch", "/runtime", "/rpc", "https://candidate", NULL
  };
  char *root_cwd[] = {
    "helper", "EXEC", "60001", "60001", "/", "/runtime", "/rpc", "file:///candidate", NULL
  };
  reset_fixture();
  CHECK(invoke(8, argv) == 2);
  CHECK(strcmp(call_log, "DGguLURE") == 0);
  CHECK(strcmp(captured_cwd, "/scratch") == 0);
  CHECK(strcmp(captured_exec_path, "/runtime") == 0);
  CHECK(strcmp(captured_exec_arguments[0], "/runtime") == 0);
  CHECK(strcmp(captured_exec_arguments[1], "/rpc") == 0);
  CHECK(strcmp(captured_exec_arguments[2], "file:///candidate") == 0);
  CHECK(strcmp(captured_exec_arguments[3], "--macos-principal") == 0);
  CHECK(strcmp(captured_exec_arguments[4], "60001") == 0);
  CHECK(strcmp(captured_exec_arguments[5], "60001") == 0);
  CHECK(captured_exec_arguments[6] == NULL);
  CHECK(captured_empty_environment == 1);

  reset_fixture(); fail_setgroups = 1; CHECK(invoke(8, argv) == 1);
  reset_fixture(); fail_setgid = 1; CHECK(invoke(8, argv) == 1);
  reset_fixture(); fail_setuid = 1; CHECK(invoke(8, argv) == 1);
  reset_fixture(); groups_count = 1; CHECK(invoke(8, argv) == 1);
  reset_fixture(); regain_uid_errno = EACCES; CHECK(invoke(8, argv) == 1);
  reset_fixture(); regain_gid_errno = EACCES; CHECK(invoke(8, argv) == 1);
  reset_fixture(); regain_uid_success = 1; CHECK(invoke(8, argv) == 1);
  reset_fixture(); regain_gid_success = 1; CHECK(invoke(8, argv) == 1);
  reset_fixture(); bad_effective_uid = 1; CHECK(invoke(8, argv) == 1);
  for (int field = 1; field <= 4; field += 1) {
    reset_fixture(); corrupt_drop_field = field; CHECK(invoke(8, argv) == 1);
  }
  for (int field = 1; field <= 4; field += 1) {
    reset_fixture(); corrupt_after_regain_field = field; CHECK(invoke(8, argv) == 1);
  }
  reset_fixture(); chdir_result = -1; CHECK(invoke(8, argv) == 1);
  reset_fixture(); execve_returns = 1; CHECK(invoke(8, argv) == 1);
  reset_fixture(); CHECK(invoke(7, argv) == 1);
  reset_fixture(); CHECK(invoke(9, argv) == 1);
  reset_fixture(); CHECK(invoke(8, bad_cwd) == 1);
  reset_fixture(); CHECK(invoke(8, bad_runtime) == 1);
  reset_fixture(); CHECK(invoke(8, bad_rpc) == 1);
  reset_fixture(); CHECK(invoke(8, bad_url) == 1);
  reset_fixture(); CHECK(invoke(8, bad_scheme) == 1);
  reset_fixture(); CHECK(invoke(8, root_cwd) == 1);
  return 0;
}

static int test_kill(void) {
  char *argv[] = {"helper", "KILL_UID", "60001", "60001", NULL};
  char *output;
  int result;
  reset_fixture();
  output = capture_stdout(4, argv, &result);
  CHECK(result == 0);
  CHECK(strcmp(call_log, "GguLURK") == 0);
  CHECK(strcmp(output, "{\"ok\":true}") == 0);
  free(output);

  reset_fixture(); kill_result = -1; kill_errno = ESRCH;
  output = capture_stdout(4, argv, &result);
  CHECK(result == 0 && strcmp(output, "{\"ok\":true}") == 0);
  free(output);

  reset_fixture(); kill_result = -1; kill_errno = EPERM;
  output = capture_stdout(4, argv, &result);
  CHECK(result == 1 && output[0] == '\0');
  free(output);
  return 0;
}

static void set_process(size_t index, pid_t pid, uid_t real_uid, uid_t effective_uid) {
  census_rows[index].kp_proc.p_pid = pid;
  census_rows[index].kp_eproc.e_pcred.p_ruid = real_uid;
  census_rows[index].kp_eproc.e_ucred.cr_uid = effective_uid;
}

static int test_census(void) {
  char *argv[] = {"helper", "CENSUS_UID", "60001", NULL};
  char *minimum[] = {"helper", "CENSUS_UID", "60000", NULL};
  char *maximum[] = {"helper", "CENSUS_UID", "64999", NULL};
  const int failing_modes[] = {1, 2, 3, 4, 6};
  char *output;
  int result;
  reset_fixture();
  census_rows_count = 4;
  set_process(0, 9, 60001, 1);
  set_process(1, 3, 1, 60001);
  set_process(2, 7, 60001, 60001);
  set_process(3, 8, 1, 1);
  output = capture_stdout(3, argv, &result);
  CHECK(result == 0 && sysctl_calls == 2);
  CHECK(strcmp(output, "{\"pids\":[3,7,9]}") == 0);
  free(output);

  reset_fixture(); census_rows_count = 2;
  set_process(0, 2, 1, 1); set_process(1, 4, 2, 2);
  output = capture_stdout(3, argv, &result);
  CHECK(result == 0 && strcmp(output, "{\"pids\":[]}") == 0);
  free(output);

  reset_fixture(); census_rows_count = 1; set_process(0, 4, 1, 1);
  output = capture_stdout(3, minimum, &result);
  CHECK(result == 0 && strcmp(output, "{\"pids\":[]}") == 0);
  free(output);
  reset_fixture(); census_rows_count = 1; set_process(0, 4, 1, 1);
  output = capture_stdout(3, maximum, &result);
  CHECK(result == 0 && strcmp(output, "{\"pids\":[]}") == 0);
  free(output);

  reset_fixture(); census_rows_count = 2;
  set_process(0, 5, 60001, 1); set_process(1, 6, 1, 60001); sysctl_mode = 5;
  output = capture_stdout(3, argv, &result);
  CHECK(result == 0 && strcmp(output, "{\"pids\":[5]}") == 0);
  free(output);

  reset_fixture(); observed_effective_uid = 60001;
  output = capture_stdout(3, argv, &result); CHECK(result == 1); free(output);
  reset_fixture(); census_rows_count = 1; set_process(0, 0, 60001, 1);
  output = capture_stdout(3, argv, &result); CHECK(result == 1); free(output);
  reset_fixture(); census_rows_count = 2; set_process(0, 4, 60001, 1); set_process(1, 4, 1, 60001);
  output = capture_stdout(3, argv, &result); CHECK(result == 1); free(output);
  reset_fixture(); census_rows_count = MAXIMUM_CENSUS + 1;
  for (size_t index = 0; index < census_rows_count; index += 1)
    set_process(index, (pid_t)index + 1, 60001, 1);
  output = capture_stdout(3, argv, &result); CHECK(result == 1); free(output);

  for (size_t index = 0; index < sizeof(failing_modes) / sizeof(failing_modes[0]); index += 1) {
    reset_fixture(); census_rows_count = 1;
    set_process(0, 5, 60001, 1); sysctl_mode = failing_modes[index];
    output = capture_stdout(3, argv, &result); CHECK(result == 1); free(output);
  }
  return 0;
}

int main(void) {
  int result;
  (void)freopen("/dev/null", "w", stderr);
  result = test_closed_inputs(); if (result != 0) return result;
  result = test_exec_and_credentials(); if (result != 0) return result;
  result = test_kill(); if (result != 0) return result;
  result = test_census(); if (result != 0) return result;
  (void)puts("macos helper fixture ok");
  return 0;
}
