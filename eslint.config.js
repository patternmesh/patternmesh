import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["**/dist/**", "**/node_modules/**", "**/docs/api/**", "site/**"] },
  ...tseslint.config(eslint.configs.recommended, ...tseslint.configs.strict, {
    languageOptions: {
      globals: {
        Buffer: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-undef": "off",
    },
  }),
  eslintConfigPrettier,
];
