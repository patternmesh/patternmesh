/** @type {import("syncpack").RcFile} */
export default {
  versionGroups: [
    {
      label: "aws-sdk-v3",
      dependencies: ["@aws-sdk/*"],
      packages: ["packages/*"]
    }
  ]
};
