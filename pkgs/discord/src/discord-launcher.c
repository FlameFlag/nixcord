#include <errno.h>
#include <stdckdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

#define DISABLE_BREAKING_UPDATES "@disable_breaking_updates@"
#define STAGE_MODULES "@stage_modules@"
#define MODULES_DIR "@modules_dir@"
#define DEPLOY_KRISP "@deploy_krisp@"
#define TARGET "@target@"
#define ENABLE_KRISP @enable_krisp@
#define ENABLE_AUTOSCROLL @enable_autoscroll@

static_assert(__STDC_VERSION__ >= 202311L, "discord-launcher.c requires C23");

extern char **environ;

static constexpr bool enable_krisp = ENABLE_KRISP;
static constexpr bool enable_autoscroll = ENABLE_AUTOSCROLL;

static char disable_breaking_updates_path[] = DISABLE_BREAKING_UPDATES;
static char stage_modules_path[] = STAGE_MODULES;
static char modules_dir[] = MODULES_DIR;
static char deploy_krisp_path[] = DEPLOY_KRISP;
static char target_path[] = TARGET;
static char autoscroll_arg[] = "--enable-blink-features=MiddleClickAutoscroll";

[[nodiscard]] static int wait_for_child(pid_t pid, const char *name) {
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
  pid_t pid = 0;
  int spawn_error = posix_spawn(&pid, helper_argv[0], nullptr, nullptr, helper_argv, environ);
  if (spawn_error != 0) {
    fprintf(stderr, "failed to spawn %s: %s\n", helper_argv[0], strerror(spawn_error));
    exit(127);
  }

  int status = wait_for_child(pid, helper_argv[0]);
  if (status != 0) {
    exit(status);
  }
}

[[nodiscard]] static char **make_next_argv(int argc, char **argv) {
  if (argc < 0) {
    fprintf(stderr, "invalid argc\n");
    return nullptr;
  }

  size_t base_argc = argc == 0 ? 1 : (size_t)argc;
  size_t extra_argc = enable_autoscroll ? 1 : 0;
  size_t next_argc_without_null = 0;
  size_t next_argc = 0;
  if (
      ckd_add(&next_argc_without_null, base_argc, extra_argc) ||
      ckd_add(&next_argc, next_argc_without_null, (size_t)1)) {
    fprintf(stderr, "argv is too large\n");
    return nullptr;
  }

  char **next_argv = nullptr;
  size_t alloc_size = 0;
  if (ckd_mul(&alloc_size, next_argc, sizeof(*next_argv))) {
    fprintf(stderr, "argv is too large\n");
    return nullptr;
  }

  next_argv = malloc(alloc_size);
  if (next_argv == nullptr) {
    fprintf(stderr, "failed to allocate argv: %s\n", strerror(errno));
    return nullptr;
  }

  next_argv[0] = target_path;
  for (int i = 1; i < argc; i++) {
    next_argv[i] = argv[i];
  }
  if (enable_autoscroll) {
    next_argv[base_argc] = autoscroll_arg;
  }
  next_argv[next_argc - 1] = nullptr;

  return next_argv;
}

int main(int argc, char **argv) {
  char *const disable_updates_argv[] = { disable_breaking_updates_path, nullptr };
  char *const stage_modules_argv[] = { stage_modules_path, modules_dir, nullptr };

  run_or_exit(disable_updates_argv);
  run_or_exit(stage_modules_argv);
  if (enable_krisp) {
    char *const deploy_krisp_argv[] = { deploy_krisp_path, nullptr };
    run_or_exit(deploy_krisp_argv);
  }

  char **next_argv = make_next_argv(argc, argv);
  if (next_argv == nullptr) {
    return 127;
  }

  execv(target_path, next_argv);
  fprintf(stderr, "failed to exec %s: %s\n", target_path, strerror(errno));
  free(next_argv);
  return 127;
}
