import esmock from "esmock";
import { assert, describe, it } from "poku";
import sinon from "sinon";

describe("CLI tests", () => {
  describe("submitBom()", () => {
    it("should successfully report the SBOM with given project id, name, version and a single tag", async () => {
      const fakeGotResponse = {
        json: sinon.stub().resolves({ success: true }),
      };

      const gotStub = sinon.stub().returns(fakeGotResponse);
      gotStub.extend = sinon.stub().returns(gotStub);

      const { submitBom } = await esmock("./index.js", {
        got: { default: gotStub },
      });

      const serverUrl = "https://dtrack.example.com";
      const projectId = "f7cb9f02-8041-4991-9101-b01fa07a6522";
      const projectName = "cdxgen-test-project";
      const projectVersion = "1.0.0";
      const projectTag = "tag1";
      const bomContent = { bom: "test" };
      const apiKey = "TEST_API_KEY";
      const skipDtTlsCheck = false;

      const expectedRequestPayload = {
        autoCreate: "true",
        bom: "eyJib20iOiJ0ZXN0In0=", // stringified and base64 encoded bomContent
        project: projectId,
        projectName,
        projectVersion,
        projectTags: [{ name: projectTag }],
      };

      await submitBom(
        {
          serverUrl,
          projectId,
          projectName,
          projectVersion,
          apiKey,
          skipDtTlsCheck,
          projectTag,
        },
        bomContent,
      );

      // Verify got was called exactly once
      sinon.assert.calledOnce(gotStub);

      // Grab call arguments
      const [calledUrl, options] = gotStub.firstCall.args;

      assert.equal(calledUrl, `${serverUrl}/api/v1/bom`);
      assert.equal(options.method, "PUT");
      assert.equal(options.https.rejectUnauthorized, !skipDtTlsCheck);
      assert.equal(options.headers["X-Api-Key"], apiKey);
      assert.match(options.headers["user-agent"], /@CycloneDX\/cdxgen/);
      assert.deepEqual(options.json, expectedRequestPayload);
    });

    it("should successfully report the SBOM with given parent project, name, version and multiple tags", async () => {
      const fakeGotResponse = {
        json: sinon.stub().resolves({ success: true }),
      };

      const gotStub = sinon.stub().returns(fakeGotResponse);
      gotStub.extend = sinon.stub().returns(gotStub);

      const { submitBom } = await esmock("./index.js", {
        got: { default: gotStub },
      });

      const serverUrl = "https://dtrack.example.com";
      const projectName = "cdxgen-test-project";
      const projectVersion = "1.1.0";
      const projectTags = ["tag1", "tag2"];
      const parentProjectId = "5103b8b4-4ca3-46ea-8051-036a3b2ab17e";
      const bomContent = {
        bom: "test2",
      };
      const apiKey = "TEST_API_KEY";
      const skipDtTlsCheck = false;

      const expectedRequestPayload = {
        autoCreate: "true",
        bom: "eyJib20iOiJ0ZXN0MiJ9", // stringified and base64 encoded bomContent
        parentUUID: parentProjectId,
        projectName,
        projectVersion,
        projectTags: [{ name: projectTags[0] }, { name: projectTags[1] }],
      };

      await submitBom(
        {
          serverUrl,
          parentProjectId,
          projectName,
          projectVersion,
          apiKey,
          skipDtTlsCheck,
          projectTag: projectTags,
        },
        bomContent,
      );

      // Verify got was called exactly once
      sinon.assert.calledOnce(gotStub);

      // Grab call arguments
      const [calledUrl, options] = gotStub.firstCall.args;

      // Assert call arguments against expectations
      assert.equal(calledUrl, `${serverUrl}/api/v1/bom`);
      assert.equal(options.method, "PUT");
      assert.equal(options.https.rejectUnauthorized, !skipDtTlsCheck);
      assert.equal(options.headers["X-Api-Key"], apiKey);
      assert.match(options.headers["user-agent"], /@CycloneDX\/cdxgen/);
      assert.deepEqual(options.json, expectedRequestPayload);
    });
  });

  describe("vendored directory exclusion (#3814)", () => {
    // Note: esmock self-referential mocking does not intercept sibling function calls
    // within the same module (createMultiXBom calls createPHPBom directly, not via
    // exports). These tests verify the underlying behavior at the createPHPBom level
    // using the test/data/node-modules-scanning fixture, which contains a
    // composer.lock inside node_modules/moment-timezone/.

    it("should find composer components inside node_modules without exclude", async () => {
      const { createPHPBom } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const fixturePath = new URL(
        "../../test/data/node-modules-scanning",
        import.meta.url,
      ).pathname;
      const result = createPHPBom(fixturePath, {
        multiProject: true,
        installDeps: false,
      });
      const hasComposerComponent = result?.bomJson?.components?.some(
        (c) =>
          c.purl?.includes("moment-timezone") ||
          c.name?.includes("moment-timezone"),
      );
      assert.ok(
        hasComposerComponent,
        "should find composer.lock inside node_modules when not excluded",
      );
    });

    it("should NOT find composer components inside node_modules with exclude", async () => {
      const { createPHPBom } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const fixturePath = new URL(
        "../../test/data/node-modules-scanning",
        import.meta.url,
      ).pathname;
      const result = createPHPBom(fixturePath, {
        multiProject: true,
        installDeps: false,
        exclude: ["**/node_modules/**"],
      });
      const hasComposerComponent = result?.bomJson?.components?.some(
        (c) =>
          c.purl?.includes("moment-timezone") ||
          c.name?.includes("moment-timezone"),
      );
      assert.ok(
        !hasComposerComponent,
        "should NOT find composer.lock inside node_modules when **/node_modules/** is excluded",
      );
    });

    it("excludeVendoredDirs + createPHPBom: npm exclusions prevent PHP from scanning node_modules", async () => {
      const { excludeVendoredDirs, createPHPBom } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const fixturePath = new URL(
        "../../test/data/node-modules-scanning",
        import.meta.url,
      ).pathname;
      // Step 1: Simulate npm scanner having run and generated exclusions
      const options = {
        multiProject: true,
        installDeps: false,
      };
      excludeVendoredDirs("js", fixturePath, options);
      // Step 2: Run PHP scanner with the exclusions in place
      options.currentEcosystem = "php";
      const result = createPHPBom(fixturePath, options);
      // The composer.json inside node_modules/moment-timezone/ should NOT
      // generate a PHP component — it's inside JS's vendored dir
      const hasMomentTimezone = result?.bomJson?.components?.some(
        (c) =>
          c.purl?.includes("moment-timezone") ||
          c.name?.includes("moment-timezone"),
      );
      assert.ok(
        !hasMomentTimezone,
        "createPHPBom should NOT find composer.json inside node_modules after excludeVendoredDirs('js')",
      );
    });
  });

  describe("excludeVendoredDirs", () => {
    const fixturePath = new URL(
      "../../test/data/node-modules-scanning",
      import.meta.url,
    ).pathname;

    it("should generate path-relative exclusions from manifest locations", async () => {
      const { excludeVendoredDirs } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const options = {};
      excludeVendoredDirs("js", fixturePath, options);
      assert.ok(
        options.ecosystemExcludes?.js?.length > 0,
        "should have js exclusions",
      );
      assert.ok(
        options.ecosystemExcludes.js.some((p) => p.includes("node_modules")),
        "should exclude node_modules relative to package.json location",
      );
      assert.ok(
        !options.ecosystemExcludes.js.some((p) => p.startsWith("**/")),
        "should use path-relative patterns, not broad globs",
      );
    });

    it("should skip for OCI scans", async () => {
      const { excludeVendoredDirs } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const options = { projectType: ["oci"] };
      excludeVendoredDirs("js", fixturePath, options);
      assert.ok(!options.ecosystemExcludes);
    });

    it("should handle unknown ecosystem gracefully", async () => {
      const { excludeVendoredDirs } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const options = {};
      excludeVendoredDirs("unknown-lang", fixturePath, options);
      assert.ok(!options.ecosystemExcludes);
    });

    it("should generate exclusions for PHP composer.json locations", async () => {
      const { excludeVendoredDirs } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const options = {};
      excludeVendoredDirs("php", fixturePath, options);
      assert.ok(
        options.ecosystemExcludes?.php?.length > 0,
        "should have php exclusions",
      );
      assert.ok(
        options.ecosystemExcludes.php.some(
          (p) => p.includes("src") && p.includes("vendor"),
        ),
        "should exclude vendor/ relative to src/composer.json",
      );
    });

    it("should generate patterns with forward slashes (not backslashes)", async () => {
      const { excludeVendoredDirs } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const options = {};
      excludeVendoredDirs("java", fixturePath, options);
      assert.ok(
        options.ecosystemExcludes?.java?.length > 0,
        "should have java exclusions",
      );
      for (const pattern of options.ecosystemExcludes.java) {
        assert.ok(
          !pattern.includes("\\"),
          `pattern "${pattern}" should not contain backslashes`,
        );
      }
    });

    it("should not generate exclusions for manifests inside vendored dirs", async () => {
      const { excludeVendoredDirs } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const options = {};
      excludeVendoredDirs("js", fixturePath, options);
      // The fixture has node_modules/moment-timezone/package.json
      // which should NOT generate node_modules/moment-timezone/node_modules/**
      const spurious = options.ecosystemExcludes.js.filter((p) =>
        p.startsWith("node_modules/moment-timezone/"),
      );
      assert.equal(
        spurious.length,
        0,
        `should not generate patterns for manifests inside node_modules: ${JSON.stringify(spurious)}`,
      );
    });

    it("should handle root-level manifest (no subdirectory prefix)", async () => {
      const { excludeVendoredDirs } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const options = {};
      excludeVendoredDirs("js", fixturePath, options);
      // Root package.json should generate "node_modules/**" (no prefix)
      assert.ok(
        options.ecosystemExcludes.js.some((p) => p === "node_modules/**"),
        "should generate 'node_modules/**' for root-level package.json",
      );
    });

    it("should generate separate exclusions for monorepo sub-projects", async () => {
      const { excludeVendoredDirs } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const options = {};
      excludeVendoredDirs("js", fixturePath, options);
      // Root package.json → node_modules/**
      assert.ok(
        options.ecosystemExcludes.js.includes("node_modules/**"),
        "should have root node_modules exclusion",
      );
      // frontend/package.json → frontend/node_modules/**
      assert.ok(
        options.ecosystemExcludes.js.includes("frontend/node_modules/**"),
        "should have frontend/node_modules exclusion for monorepo sub-project",
      );
    });

    it("should generate exclusions for Python uv.lock locations", async () => {
      const { excludeVendoredDirs } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const pyFixturePath = new URL(
        "../../test/data/python-vendored-dirs",
        import.meta.url,
      ).pathname;
      const options = {};
      excludeVendoredDirs("py", pyFixturePath, options);
      const patterns = options.ecosystemExcludes?.py ?? [];
      assert.ok(
        patterns.some((p) => p.includes("subapp-uv/")),
        `uv.lock subdir should produce exclusion patterns, got: ${JSON.stringify(patterns)}`,
      );
    });

    it("should generate exclusions for Python requirements.txt locations", async () => {
      const { excludeVendoredDirs } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const pyFixturePath = new URL(
        "../../test/data/python-vendored-dirs",
        import.meta.url,
      ).pathname;
      const options = {};
      excludeVendoredDirs("py", pyFixturePath, options);
      const patterns = options.ecosystemExcludes?.py ?? [];
      assert.ok(
        patterns.some((p) => p.includes("subapp-requirements/")),
        `requirements.txt subdir should produce exclusion patterns, got: ${JSON.stringify(patterns)}`,
      );
    });

    it("should generate exclusions for Python Pipfile.lock locations", async () => {
      const { excludeVendoredDirs } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const pyFixturePath = new URL(
        "../../test/data/python-vendored-dirs",
        import.meta.url,
      ).pathname;
      const options = {};
      excludeVendoredDirs("py", pyFixturePath, options);
      const patterns = options.ecosystemExcludes?.py ?? [];
      assert.ok(
        patterns.some((p) => p.includes("subapp-pipfile-lock/")),
        `Pipfile.lock subdir should produce exclusion patterns, got: ${JSON.stringify(patterns)}`,
      );
    });

    it("should generate exclusions for Python requirements-dev.txt via glob", async () => {
      const { excludeVendoredDirs } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const pyFixturePath = new URL(
        "../../test/data/python-vendored-dirs",
        import.meta.url,
      ).pathname;
      const options = {};
      excludeVendoredDirs("py", pyFixturePath, options);
      const patterns = options.ecosystemExcludes?.py ?? [];
      assert.ok(
        patterns.some((p) => p.includes("subapp-reqdev/")),
        `requirements-dev.txt subdir should produce exclusion patterns, got: ${JSON.stringify(patterns)}`,
      );
    });

    it("should generate exclusions for Java build.sbt locations", async () => {
      const { excludeVendoredDirs } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const fixPath = new URL(
        "../../test/data/vendored-dirs-audit",
        import.meta.url,
      ).pathname;
      const options = {};
      excludeVendoredDirs("java", fixPath, options);
      const patterns = options.ecosystemExcludes?.java ?? [];
      assert.ok(
        patterns.some((p) => p.includes("sbt-project/")),
        `build.sbt subdir should produce exclusion patterns, got: ${JSON.stringify(patterns)}`,
      );
    });

    it("should generate exclusions for Python pdm.lock locations", async () => {
      const { excludeVendoredDirs } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const fixPath = new URL(
        "../../test/data/vendored-dirs-audit",
        import.meta.url,
      ).pathname;
      const options = {};
      excludeVendoredDirs("py", fixPath, options);
      const patterns = options.ecosystemExcludes?.py ?? [];
      assert.ok(
        patterns.some((p) => p.includes("pdm-project/")),
        `pdm.lock subdir should produce exclusion patterns, got: ${JSON.stringify(patterns)}`,
      );
    });

    it("should generate exclusions for Python pixi.toml locations", async () => {
      const { excludeVendoredDirs } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const fixPath = new URL(
        "../../test/data/vendored-dirs-audit",
        import.meta.url,
      ).pathname;
      const options = {};
      excludeVendoredDirs("py", fixPath, options);
      const patterns = options.ecosystemExcludes?.py ?? [];
      assert.ok(
        patterns.some((p) => p.includes("pixi-project/")),
        `pixi.toml subdir should produce exclusion patterns, got: ${JSON.stringify(patterns)}`,
      );
    });

    it("should generate exclusions for Ruby *.gemspec locations", async () => {
      const { excludeVendoredDirs } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const fixPath = new URL(
        "../../test/data/vendored-dirs-audit",
        import.meta.url,
      ).pathname;
      const options = {};
      excludeVendoredDirs("ruby", fixPath, options);
      const patterns = options.ecosystemExcludes?.ruby ?? [];
      assert.ok(
        patterns.some((p) => p.includes("gem-project/")),
        `*.gemspec subdir should produce exclusion patterns, got: ${JSON.stringify(patterns)}`,
      );
    });

    it("should generate exclusions for C++ conanfile.txt locations", async () => {
      const { excludeVendoredDirs } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const fixPath = new URL(
        "../../test/data/vendored-dirs-audit",
        import.meta.url,
      ).pathname;
      const options = {};
      excludeVendoredDirs("cpp", fixPath, options);
      const patterns = options.ecosystemExcludes?.cpp ?? [];
      assert.ok(
        patterns.some((p) => p.includes("conan-project/")),
        `conanfile.txt subdir should produce exclusion patterns, got: ${JSON.stringify(patterns)}`,
      );
    });

    it("should generate exclusions for Elixir mix.exs locations", async () => {
      const { excludeVendoredDirs } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const fixPath = new URL(
        "../../test/data/vendored-dirs-audit",
        import.meta.url,
      ).pathname;
      const options = {};
      excludeVendoredDirs("elixir", fixPath, options);
      const patterns = options.ecosystemExcludes?.elixir ?? [];
      assert.ok(
        patterns.some((p) => p.includes("elixir-project/")),
        `mix.exs subdir should produce exclusion patterns, got: ${JSON.stringify(patterns)}`,
      );
    });

    it("should add nothing for ecosystem with no manifests found", async () => {
      const { excludeVendoredDirs } = await esmock("./index.js", {
        got: { default: sinon.stub() },
      });
      const emptyDir = new URL(
        "../../test/data/node-modules-scanning/rust-lib",
        import.meta.url,
      ).pathname;
      const options = {};
      // rust-lib/ has Cargo.toml but no package.json — JS should find nothing
      excludeVendoredDirs("js", emptyDir, options);
      assert.equal(
        options.ecosystemExcludes?.js?.length ?? 0,
        0,
        "should have no JS exclusions when no package.json found",
      );
    });
  });
});
