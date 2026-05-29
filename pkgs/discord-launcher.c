#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

#define DISABLE_BREAKING_UPDATES "@disable_breaking_updates@"
#define STAGE_MODULES "@stage_modules@"
#define MODULES_DIR "@modules_dir@"
#define DEPLOY_KRISP "@deploy_krisp@"
#define TARGET "@target@"
#define ENABLE_KRISP @enable_krisp@
#define ENABLE_AUTOSCROLL @enable_autoscroll@

static int wait_for_child(pid_t pid, const char *name) {
  int status = 0;

  for (;;) {
    pid_t waited = waitpid(pid, &status, 0);
    if (waited == pid) {
      break;
    }
    if (waited < 0 && errno == EINTR) {
      continue;
    }
    if (waited < 0) {
      fprintf(stderr, "failed to wait for %s: %s\n", name, strerror(errno));
    } else {
      fprintf(stderr, "waitpid returned unexpected pid for %s\n", name);
    }
    return 127;
  }

  if (WIFEXITED(status)) {
    return WEXITSTATUS(status);
  }
  if (WIFSIGNALED(status)) {
    return 128 + WTERMSIG(status);
  }
  return 127;
}

static void run_or_exit(char *const helper_argv[]) {
  pid_t pid = fork();
  if (pid == 0) {
    execv(helper_argv[0], helper_argv);
    fprintf(stderr, "failed to exec %s: %s\n", helper_argv[0], strerror(errno));
    _exit(127);
  }
  if (pid < 0) {
    fprintf(stderr, "failed to fork %s: %s\n", helper_argv[0], strerror(errno));
    exit(127);
  }

  int status = wait_for_child(pid, helper_argv[0]);
  if (status != 0) {
    exit(status);
  }
}

static char **make_next_argv(int argc, char **argv) {
  if (argc < 0) {
    fprintf(stderr, "invalid argc\n");
    return NULL;
  }

  size_t base_argc = argc == 0 ? 1 : (size_t)argc;
  size_t extra_argc = ENABLE_AUTOSCROLL ? 1 : 0;
  if (base_argc > SIZE_MAX - extra_argc - 1) {
    fprintf(stderr, "argv is too large\n");
    return NULL;
  }

  size_t next_argc = base_argc + extra_argc + 1;
  char **next_argv = NULL;
  if (next_argc > SIZE_MAX / sizeof(*next_argv)) {
    fprintf(stderr, "argv is too large\n");
    return NULL;
  }

  next_argv = calloc(next_argc, sizeof(*next_argv));
  if (next_argv == NULL) {
    fprintf(stderr, "failed to allocate argv: %s\n", strerror(errno));
    return NULL;
  }

  next_argv[0] = (char *)TARGET;
  for (int i = 1; i < argc; i++) {
    next_argv[i] = argv[i];
  }
  if (ENABLE_AUTOSCROLL) {
    next_argv[base_argc] = "--enable-blink-features=MiddleClickAutoscroll";
  }

  return next_argv;
}

int main(int argc, char **argv) {
  char *const disable_updates_argv[] = { (char *)DISABLE_BREAKING_UPDATES, NULL };
  char *const stage_modules_argv[] = { (char *)STAGE_MODULES, (char *)MODULES_DIR, NULL };

  run_or_exit(disable_updates_argv);
  run_or_exit(stage_modules_argv);
  if (ENABLE_KRISP) {
    char *const deploy_krisp_argv[] = { (char *)DEPLOY_KRISP, NULL };
    run_or_exit(deploy_krisp_argv);
  }

  char **next_argv = make_next_argv(argc, argv);
  if (next_argv == NULL) {
    return 127;
  }

  execv(TARGET, next_argv);
  fprintf(stderr, "failed to exec %s: %s\n", TARGET, strerror(errno));
  free(next_argv);
  return 127;
}
