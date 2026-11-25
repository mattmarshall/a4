import { test } from "node:test";
import assert from "node:assert/strict";
import { toJsonString } from "@bufbuild/protobuf";
import { PaperSize } from "../gen/a4/v1/sheet_pb.js";
import type { FolderFs } from "../persist/folder/fs.ts";
import { browserFixture, type FolderFixture, nodeFixture } from "../persist/folder/testing/fixtures.ts";
import { LabelProblem, readStack, readStacks, stackList, StackListSchema } from "./index.ts";
import { LintOutcome } from "./lint.ts";

const DIR = ".agents/stacks/auth";
const label = (budgetPages: number, purpose = "Start an agent on the auth service") =>
  JSON.stringify({ purpose, budgetPages });
/** `n` short, different lines. */
const rows = (n: number, tag = "Row") => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}.`).join("\n");

function suite<H>(name: string, makeFixture: () => Promise<FolderFixture<H>>) {
  const inFolder = async (files: Record<string, string | Uint8Array>, run: (fs: FolderFs) => Promise<void>) => {
    const fixture = await makeFixture();
    try {
      const folder = await fixture.folder("repo", files);
      await run(fixture.source.open(folder.handle));
    } finally {
      await fixture.dispose();
    }
  };

  test(`${name}: pages in name order, counted by paper: two A4, one A5, and two A6 use 3 pages`, async () => {
    await inFolder(
      {
        [`${DIR}/stack.json`]: label(3),
        [`${DIR}/02-service.a5.md`]: rows(10, "Service"),
        [`${DIR}/01-charter.md`]: rows(10, "Charter"),
        [`${DIR}/03-owners.a6.md`]: rows(5, "Owner"),
        [`${DIR}/04-runbook.md`]: rows(10, "Step"),
        [`${DIR}/05-oncall.a6.md`]: rows(5, "Call"),
        [`${DIR}/old/draft.md`]: rows(5),
      },
      async (fs) => {
        const stack = await readStack(fs, "auth");
        assert.ok(stack);
        const { report } = stack;
        assert.deepEqual(
          report.pages.map((p) => p.path.slice(DIR.length + 1)),
          ["01-charter.md", "02-service.a5.md", "03-owners.a6.md", "04-runbook.md", "05-oncall.a6.md"],
        );
        assert.deepEqual(
          report.pages.map((p) => p.paper),
          [PaperSize.A4, PaperSize.A5, PaperSize.A6, PaperSize.A4, PaperSize.A6],
        );
        assert.equal(report.pagesUsed, 3);
        assert.equal(report.label?.purpose, "Start an agent on the auth service");
        assert.equal(report.outcome, LintOutcome.PASS);
        assert.equal(stack.texts[0], rows(10, "Charter"));
      },
    );
  });

  test(`${name}: over budget fails by quarter pages, and a page over its size fails the stack`, async () => {
    await inFolder(
      {
        [`${DIR}/stack.json`]: label(2),
        [`${DIR}/01.md`]: rows(10),
        [`${DIR}/02.md`]: rows(10, "B"),
        [`${DIR}/03.a5.md`]: rows(10, "C"),
      },
      async (fs) => {
        const report = (await readStack(fs, "auth"))?.report;
        assert.deepEqual([report?.pagesUsed, report?.overByPages, report?.outcome], [2.5, 0.5, LintOutcome.FAIL]);
      },
    );
    await inFolder({ [`${DIR}/stack.json`]: label(3), [`${DIR}/01.a5.md`]: rows(45) }, async (fs) => {
      const report = (await readStack(fs, "auth"))?.report;
      assert.equal(report?.outcome, LintOutcome.FAIL);
      assert.equal(report?.overByPages, 0, "within budget");
      const [page] = report?.pages ?? [];
      assert.deepEqual([page?.rowsUsed, page?.pageRows, page?.outcome], [45, 42, LintOutcome.FAIL], "3 rows over");
    });
  });

  test(`${name}: a missing, unreadable, or zero-budget label warns with its reason`, async () => {
    for (const [files, problem] of [
      [{}, LabelProblem.MISSING],
      [{ [`${DIR}/stack.json`]: "{not json" }, LabelProblem.UNREADABLE],
      [{ [`${DIR}/stack.json`]: JSON.stringify({ purpose: "x" }) }, LabelProblem.NO_BUDGET],
    ] as const) {
      await inFolder({ ...files, [`${DIR}/01.md`]: rows(5) }, async (fs) => {
        const report = (await readStack(fs, "auth"))?.report;
        assert.equal(report?.labelProblem, problem);
        assert.equal(report?.outcome, LintOutcome.WARN);
        assert.equal(report?.overByPages, 0);
      });
    }
  });

  test(`${name}: a line of 20 or more characters on two pages is said twice; a short one isn't`, async () => {
    const fact = "The auth service owns sessions and refresh tokens, nothing more.";
    const short = "See the runbook.";
    await inFolder(
      {
        [`${DIR}/stack.json`]: label(3),
        [`${DIR}/01.md`]: `Charter.\n${fact}\n${short}`,
        [`${DIR}/02.md`]: `Service.\n${short}`,
        [`${DIR}/03.a6.md`]: `Owners.\nMore.\n   ${fact}   `,
      },
      async (fs) => {
        const report = (await readStack(fs, "auth"))?.report;
        assert.equal(report?.outcome, LintOutcome.WARN);
        assert.equal(report?.repeatedLines.length, 1);
        assert.deepEqual(report?.repeatedLines[0]?.pages, [`${DIR}/01.md`, `${DIR}/03.a6.md`]);
        assert.deepEqual(report?.repeatedLines[0]?.lines, [2, 3]);
        const json = toJsonString(StackListSchema, stackList(await readStacks(fs)));
        assert.ok(!json.includes("refresh tokens"), "the report never carries a page's text");
      },
    );
  });

  test(`${name}: stacks are listed in name order, and bad names and a missing folder have none`, async () => {
    await inFolder({}, async (fs) => assert.deepEqual(await readStacks(fs), []));
    await inFolder(
      {
        ".agents/stacks/billing/01.md": rows(3),
        ".agents/stacks/auth/01.md": rows(3),
        ".agents/stacks/Auth Notes/01.md": rows(3),
      },
      async (fs) => {
        assert.deepEqual(
          (await readStacks(fs)).map((s) => s.report.name),
          ["auth", "billing"],
        );
        assert.equal(await readStack(fs, "missing"), null);
      },
    );
  });
}

suite("browser", async () => browserFixture());
suite("node", nodeFixture);
