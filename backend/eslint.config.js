// eslint.config.js
import js from "@eslint/js";
import ts from "typescript-eslint";

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: ts.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        console: "readonly",
        fetch: "readonly",
        Request: "readonly",
        Response: "readonly",
        Headers: "readonly",
        ExecutionContext: "readonly",
      },
    },
rules: {
      // --- 資深開發者必備的強迫症規則 ---

      // 1. 強制處理 Promise（對 CF Worker 的 fetch 非常重要）
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",

      // 2. 嚴格規範型別一致性
      "@typescript-eslint/no-explicit-any": "error", // 不准用 any，Debug 完記得改回 error
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "@typescript-eslint/no-non-null-assertion": "warn", // 盡量避免用 "!"

      // 3. 程式碼邏輯優化
      "no-console": ["warn", { allow: ["warn", "error"] }], // 正式環境禁止 log，但允許 warn/error
      "eqeqeq": ["error", "always", { "null": "ignore" }], // 強制使用 ===（保留 == null 慣用法）
      "no-duplicate-imports": "error", // 禁止重複匯入
      "prefer-template": "error", // 強制使用樣板字串（對你的 Prompt 構建很有幫助）

      // 4. 針對 Hono/Zod 的小優化
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_",
          "caughtErrorsIgnorePattern": "^_"
        }
      ],
    },
  },
  {
    // 忽略編譯後的目錄
    ignores: ["dist/**", ".wrangler/**"],
  }
];