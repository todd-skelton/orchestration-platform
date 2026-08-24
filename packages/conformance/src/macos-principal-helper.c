#ifdef __APPLE__

#include <errno.h>
#include <grp.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/sysctl.h>
#include <sys/types.h>
#include <unistd.h>

#define MINIMUM_ID 60000UL
#define MAXIMUM_ID 64999UL
#define MAXIMUM_CENSUS 4096U

static void fail(const char *code) {
  (void)fprintf(stderr, "macos-principal:%s\n", code);
  _exit(70);
}

static unsigned long parse_id(const char *text) {
  char *end = NULL;
  unsigned long value;
  size_t index;

  if (text == NULL || text[0] == '\0') fail("identity");
  if (text[0] == '0' && text[1] != '\0') fail("identity");
  for (index = 0; text[index] != '\0'; index += 1)
    if (text[index] < '0' || text[index] > '9') fail("identity");
  errno = 0;
  value = strtoul(text, &end, 10);
  if (errno != 0 || end == NULL || *end != '\0' || value < MINIMUM_ID ||
      value > MAXIMUM_ID)
    fail("identity");
  return value;
}

static void require_absolute_path(const char *path) {
  if (path == NULL || path[0] != '/' || path[1] == '\0') fail("path");
}

static void drop_credentials(uid_t uid, gid_t gid) {
  int group_count;

  if (setgroups(0, NULL) != 0) fail("setgroups");
  if (setgid(gid) != 0) fail("setgid");
  if (setuid(uid) != 0) fail("setuid");
  if (getuid() != uid || geteuid() != uid || getgid() != gid || getegid() != gid)
    fail("credential-readback");
  group_count = getgroups(0, NULL);
  if (group_count != 0) fail("group-readback");

  errno = 0;
  if (setuid(0) == 0 || errno != EPERM) fail("uid-regain");
  errno = 0;
  if (setgid(0) == 0 || errno != EPERM) fail("gid-regain");
  if (getuid() != uid || geteuid() != uid || getgid() != gid || getegid() != gid)
    fail("credential-regain-readback");
}

static int compare_pid(const void *left, const void *right) {
  const pid_t left_pid = *(const pid_t *)left;
  const pid_t right_pid = *(const pid_t *)right;
  return (left_pid > right_pid) - (left_pid < right_pid);
}

static void census_uid(uid_t uid) {
  int mib[3] = {CTL_KERN, KERN_PROC, KERN_PROC_ALL};
  struct kinfo_proc *processes;
  pid_t pids[MAXIMUM_CENSUS];
  size_t byte_length = 0;
  size_t capacity;
  size_t count;
  size_t census_count = 0;
  size_t index;

  if (geteuid() != 0) fail("census-root");
  if (sysctl(mib, 3, NULL, &byte_length, NULL, 0) != 0 || byte_length == 0 ||
      byte_length % sizeof(struct kinfo_proc) != 0)
    fail("census-size");
  capacity = byte_length;
  processes = (struct kinfo_proc *)malloc(byte_length);
  if (processes == NULL) fail("census-allocation");
  if (sysctl(mib, 3, processes, &byte_length, NULL, 0) != 0 ||
      byte_length == 0 ||
      byte_length > capacity ||
      byte_length % sizeof(struct kinfo_proc) != 0) {
    free(processes);
    fail("census-read");
  }
  count = byte_length / sizeof(struct kinfo_proc);
  for (index = 0; index < count; index += 1) {
    const uid_t real_uid = processes[index].kp_eproc.e_pcred.p_ruid;
    const uid_t effective_uid = processes[index].kp_eproc.e_ucred.cr_uid;
    const pid_t pid = processes[index].kp_proc.p_pid;
    if (real_uid != uid && effective_uid != uid) continue;
    if (pid <= 0 || census_count >= MAXIMUM_CENSUS) {
      free(processes);
      fail("census-entry");
    }
    pids[census_count] = pid;
    census_count += 1;
  }
  free(processes);
  qsort(pids, census_count, sizeof(pid_t), compare_pid);
  for (index = 1; index < census_count; index += 1)
    if (pids[index - 1] == pids[index]) fail("census-duplicate");

  if (fputs("{\"pids\":[", stdout) == EOF) fail("census-write");
  for (index = 0; index < census_count; index += 1) {
    if (index != 0 && fputc(',', stdout) == EOF) fail("census-write");
    if (fprintf(stdout, "%d", pids[index]) < 0) fail("census-write");
  }
  if (fputs("]}", stdout) == EOF || fflush(stdout) != 0) fail("census-write");
}

static void kill_uid(uid_t uid, gid_t gid) {
  drop_credentials(uid, gid);
  errno = 0;
  if (kill(-1, SIGKILL) != 0 && errno != ESRCH) fail("kill-uid");
  if (fputs("{\"ok\":true}", stdout) == EOF || fflush(stdout) != 0)
    fail("kill-write");
}

static void execute_candidate(int argc, char **argv, uid_t uid, gid_t gid) {
  char *const empty_environment[] = {NULL};
  char *child_argv[8];

  if (argc != 8) fail("exec-arguments");
  require_absolute_path(argv[4]);
  require_absolute_path(argv[5]);
  require_absolute_path(argv[6]);
  if (strncmp(argv[7], "file:", 5) != 0 || argv[7][5] == '\0') fail("candidate-url");
  if (chdir(argv[4]) != 0) fail("exec-cwd");
  drop_credentials(uid, gid);

  child_argv[0] = argv[5];
  child_argv[1] = argv[6];
  child_argv[2] = argv[7];
  child_argv[3] = "--macos-principal";
  child_argv[4] = argv[2];
  child_argv[5] = argv[3];
  child_argv[6] = NULL;
  child_argv[7] = NULL;
  execve(argv[5], child_argv, empty_environment);
  fail("execve");
}

int main(int argc, char **argv) {
  uid_t uid;
  gid_t gid;

  if (argc < 3 || argv[1] == NULL) fail("arguments");
  uid = (uid_t)parse_id(argv[2]);
  if (strcmp(argv[1], "CENSUS_UID") == 0) {
    if (argc != 3) fail("census-arguments");
    census_uid(uid);
    return 0;
  }
  if (argc < 4) fail("arguments");
  gid = (gid_t)parse_id(argv[3]);
  if (uid != gid) fail("identity-pair");
  if (strcmp(argv[1], "KILL_UID") == 0) {
    if (argc != 4) fail("kill-arguments");
    kill_uid(uid, gid);
    return 0;
  }
  if (strcmp(argv[1], "EXEC") == 0) {
    execute_candidate(argc, argv, uid, gid);
    return 0;
  }
  fail("mode");
  return 70;
}

#else
#error "macos-principal-helper.c is Darwin-only"
#endif
