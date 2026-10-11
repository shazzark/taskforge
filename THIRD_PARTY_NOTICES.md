# Third-party license review notes

This records the reviewed production dependency findings for the current lockfile. It is not legal advice; the release owner must recheck the final distributed dependency tree and its notices.

## License metadata findings

- `archiver@7.0.1` and `unzipper@0.12.5` declare MIT. Both are ExcelJS-scoped overrides; their licenses are present in their installed packages.
- `glob@13.0.6` declares Blue Oak Model License 1.0.0. TaskForge's installed copy includes the license text. The license requires recipients of copies to receive the license text or a link; use [the Blue Oak Model License 1.0.0](https://blueoakcouncil.org/license/1.0.0).
- `png-js@2.0.0`, a PDFKit transitive dependency, omits an SPDX field but the installed upstream `LICENSE` states MIT and names Devon Govett, copyright 2017.
- `jszip@3.10.2` declares `MIT OR GPL-3.0-or-later`. TaskForge selects the MIT option; the installed package contains both license texts.

## Dependency and deprecation findings

ExcelJS 4.4.0 now resolves `archiver@7.0.1` and `unzipper@0.12.5`. This removes `buffers@0.1.1`, which had no license metadata or license file, as well as the deprecated `inflight@1.0.6` and `glob@7.2.3` chain. `glob@13.0.6` is used through archiver-utils and supports TaskForge's Node.js >=22.13 baseline. The ExcelJS API compatibility overrides are verified by the full document fixture suite, including DOCX and XLSX extraction and malformed/formula-bearing XLSX rejection. The unzipper advisory is internally inconsistent: its title says versions through 0.12.4, its affected-version body says through 0.12.3, and it lists no patched release. Installed 0.12.5 is outside both stated ranges, but upstream does not explicitly certify it as patched. ExcelJS's installed reader uses unzipper's streaming `Parse` API, while the advisory concerns extraction-to-filesystem path validation. Recheck the upstream advisory and package behavior before release; npm audit's zero-vulnerability result does not settle this separate GitHub advisory.

Upstream evidence: [ExcelJS issue #2866](https://github.com/exceljs/exceljs/issues/2866) reports that unzipper 0.12.3 removes the unlicensed buffers package and notes no interference with ExcelJS 4.4.0; [unzipper security advisory GHSA-2756-j7rr-9464](https://github.com/ZJONSSON/node-unzipper/security/advisories/GHSA-2756-j7rr-9464); [glob 13.0.6 package metadata](https://github.com/isaacs/node-glob/blob/v13.0.6/package.json); [glob 13.0.6 license](https://github.com/isaacs/node-glob/blob/v13.0.6/LICENSE.md); [archiver 7.0.1 changelog](https://github.com/archiverjs/node-archiver/blob/7.0.1/CHANGELOG.md).

`npm audit --omit=dev --audit-level=high` reported zero production vulnerabilities. The installed production tree passed `npm ls --omit=dev --all --parseable`. Exact versions and upstream license/deprecation data must be rechecked when dependencies change. These notes record evidence, not a legal determination.
