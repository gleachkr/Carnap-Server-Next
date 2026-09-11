import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openLibSqlStorage } from "../src/worker/infrastructure/database/libsql";

/**
 * What a self-hoster is told when the database will not open.
 *
 * libsql answers with a bare SQLite result code — `…/carnap.db: 14` — and the
 * same number covers a missing directory, an unwritable one and an unreadable
 * file. Everything here is about the difference between that number and a
 * sentence naming what to change.
 */

/** A directory at a given mode, removed however the body ends. */
async function withDirectory<T>(
  mode: number,
  body: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "carnap-open-"));

  try {
    chmodSync(directory, mode);

    return await body(directory);
  } finally {
    // Writable again first, or the removal fails for the same reason the open
    // did.
    chmodSync(directory, 0o700);
    rmSync(directory, { force: true, recursive: true });
  }
}

async function openFailure(path: string): Promise<Error> {
  try {
    const storage = await openLibSqlStorage(`file:${path}`);

    storage.close();
    throw new Error(`expected opening ${path} to fail`);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);

    return error as Error;
  }
}

describe("opening a self-hosted database", () => {
  // Root ignores the permission bits, so the interesting case cannot be built
  // in a container that runs the suite as root.
  const asRoot = process.getuid?.() === 0;

  test.skipIf(asRoot)(
    "an unwritable directory is reported as one, with its mode and the uid",
    async () => {
      const error = await withDirectory(0o500, async (directory) =>
        openFailure(join(directory, "carnap.db")),
      );

      expect(error.message).toContain("is not writable by this process");
      expect(error.message).toContain("mode 0500");
      expect(error.message).toContain(`uid ${process.getuid?.()}`);
      // The directory and not the file: an operator who chmods only the
      // database is still stuck, because SQLite has sidecars to write.
      expect(error.message).toContain("-wal");
      // libsql's own message is kept, so the result code is still there for
      // anyone who wants it.
      expect(String(error.cause)).toContain("14");
    },
  );

  test.skipIf(asRoot)(
    "an unreadable database in a writable directory names the file",
    async () => {
      const error = await withDirectory(0o700, async (directory) => {
        const path = join(directory, "carnap.db");

        writeFileSync(path, "");
        chmodSync(path, 0o000);

        return openFailure(path);
      });

      expect(error.message).toContain("is writable by this process");
      expect(error.message).toContain("but the database file");
    },
  );

  test("a missing directory says so rather than reporting a code", async () => {
    const error = await openFailure(
      join(tmpdir(), "carnap-open-absent", "carnap.db"),
    );

    expect(error.message).toContain("does not exist");
    expect(error.message).toContain("libsql will not create it");
  });

  test("a writable directory opens as before", async () => {
    await withDirectory(0o700, async (directory) => {
      const storage = await openLibSqlStorage(
        `file:${join(directory, "carnap.db")}`,
      );

      storage.close();
    });
  });
});
