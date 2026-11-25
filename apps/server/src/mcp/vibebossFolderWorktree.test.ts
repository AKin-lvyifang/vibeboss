import { assert, describe, it } from "@effect/vitest";

import { pickFolderRepository } from "./vibebossFolderWorktree.ts";

const folders = [
  { path: "/work/folder/plugin", name: "plugin" },
  { path: "/work/folder/web", name: "web" },
];

describe("pickFolderRepository", () => {
  it("matches a name, an absolute path, or a path under the root", () => {
    for (const requested of ["plugin", "/work/folder/plugin/", "./plugin"]) {
      assert.deepEqual(pickFolderRepository(folders, requested, "/work/folder"), {
        folder: folders[0]!,
      });
    }
  });

  it("names the choices when the repository is unknown", () => {
    const picked = pickFolderRepository(folders, "docs", "/work/folder");
    assert.ok("error" in picked && picked.error.includes("plugin, web"));
  });
});
