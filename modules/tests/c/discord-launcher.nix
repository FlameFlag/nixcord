{ pkgs }:

let
  inherit (pkgs) lib;

  # CI validates the launcher with final C23 support even when the platform
  # default compiler still reports a draft C2x __STDC_VERSION__.
  cStdenv = pkgs.llvmPackages_latest.stdenv;
  requiredCVersion = "202311L";

  strictCFlags = [
    "-std=c23"
    "-Wall"
    "-Wextra"
    "-Wpedantic"
    "-Wconversion"
    "-Wsign-conversion"
    "-Wcast-qual"
    "-Wwrite-strings"
    "-Wformat=2"
    "-Wshadow"
    "-Wstrict-prototypes"
    "-Wmissing-prototypes"
    "-Wold-style-definition"
    "-Wundef"
    "-Wvla"
    "-Walloca"
    "-Werror"
    "-Os"
  ];

  sanitizerCFlags = strictCFlags ++ [
    "-O1"
    "-g"
    "-fsanitize=address,undefined"
    "-fno-omit-frame-pointer"
  ];

  trueBin = "${lib.getExe' pkgs.coreutils "true"}";

  compileAndSmoke = name: enableKrisp: enableAutoscroll: ''
    printf "" | cc -std=c23 -dM -E - | grep -F '#define __STDC_VERSION__ ${requiredCVersion}'

    cp ${../../../pkgs/discord/src/discord-launcher.c} ${name}.c
    substituteInPlace ${name}.c \
      --replace-fail "@disable_breaking_updates@" "${trueBin}" \
      --replace-fail "@stage_modules@" "${trueBin}" \
      --replace-fail "@modules_dir@" "$TMPDIR/modules" \
      --replace-fail "@deploy_krisp@" "${if enableKrisp then trueBin else ""}" \
      --replace-fail "@target@" "${trueBin}" \
      --replace-fail "@enable_krisp@" "${if enableKrisp then "1" else "0"}" \
      --replace-fail "@enable_autoscroll@" "${if enableAutoscroll then "1" else "0"}"

      cc ${lib.escapeShellArgs strictCFlags} -o ${name} ${name}.c
      cc ${lib.escapeShellArgs sanitizerCFlags} -o ${name}-sanitized ${name}.c
      cppcheck \
        --std=c23 \
        --enable=warning,style,performance,portability \
        --error-exitcode=1 \
        --suppress=missingIncludeSystem \
        --suppress=normalCheckLevelMaxBranches \
        ${name}.c
      ./${name} --nixcord-c-launcher-smoke
  '';
in
pkgs.runCommand "discord-launcher-c-check"
  {
    nativeBuildInputs = [
      cStdenv.cc
      pkgs.cppcheck
    ];
  }
  ''
    ${compileAndSmoke "discord-launcher-full" true true}
    ${compileAndSmoke "discord-launcher-minimal" false false}

    touch "$out"
  ''
