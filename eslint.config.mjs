import next from "eslint-config-next";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [".next/**", "node_modules/**"],
  },
  ...next,
  ...nextCoreWebVitals,
  ...nextTypeScript,
];

export default config;
