# Third-party license review notes

This file records the reviewed findings for the currently installed dependency tree. It is not legal advice; a release owner should confirm distribution obligations for the final locked tree.

## License metadata findings

- `png-js@2.0.0` is a transitive dependency of `pdfkit@0.20.2`. Its package metadata omits an SPDX license field, but the installed upstream `LICENSE` file states MIT and names Devon Govett, copyright 2017. The MIT license text is included in the package's installed `node_modules/png-js/LICENSE`.
- `jszip@3.10.2` declares `MIT OR GPL-3.0-or-later`. The upstream `LICENSE.markdown` explicitly permits either choice. TaskForge selects the MIT option for this dependency and its notice. The package's installed file includes both license texts.
- `buffers@0.1.1` currently appears through ExcelJS → unzipper → binary and has no license metadata or package license file. This is unresolved and is a release blocker until the dependency is removed or an acceptable license is independently established.

The selected MIT notices are retained with the installed packages and can be inspected in a clean install. Exact package versions must be rechecked when the lockfile changes.

## Deprecation findings

`glob@7.2.3` and `inflight@1.0.6` are deprecated transitive dependencies in the ExcelJS archive path. Do not force a major-version override without verified compatibility. Registry access and DOCX/XLSX regression verification are required before changing this tree. The 2026-10-11 installed-tree scan still reports these packages; this note does not claim remediation.
