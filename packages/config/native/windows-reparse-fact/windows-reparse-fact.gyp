{
  "variables": {
    "source_root%": ""
  },
  "targets": [
    {
      "target_name": "windows_reparse_fact",
      "sources": ["<(source_root)/packages/config/native/windows-reparse-fact/addon.cc"],
      "product_dir": "<(module_root_dir)/out",
      "defines": ["UNICODE", "_UNICODE", "_WIN32_WINNT=0x0602"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": ["/std:c++20"]
        }
      }
    },
    {
      "target_name": "windows_reparse_fact_mutants",
      "sources": ["<(source_root)/test/config/native/windows-reparse-fact-mutants.cc"],
      "product_dir": "<(module_root_dir)/out",
      "defines": ["UNICODE", "_UNICODE", "_WIN32_WINNT=0x0602"],
      "libraries": ["advapi32.lib"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": ["/std:c++20"]
        }
      }
    }
  ]
}
