# Spec Delta

## Purpose

Defines the signed package a third-party pen or overlay ships in, the checks
that prove who signed it and that its code is what was signed, and the
publisher commands that make keys and packages.

## ADDED Requirements

### Requirement: One file per plugin
A plugin package SHALL be one file holding three parts: a manifest, an
Ed25519 signature over the manifest's exact bytes, and the plugin's code as
one self-contained script that imports nothing. The file SHALL be an
`a4.v1.PluginPackage` protobuf message, and a package larger than 16 MiB
SHALL be refused.

#### Scenario: A packed plugin reads back
- **WHEN** a publisher packs the Word length example and A4 reads the file
- **THEN** A4 finds the manifest, the signature, and the code, and the code is the script that was packed, byte for byte

#### Scenario: A package that's too large
- **WHEN** A4 reads a 17 MiB package
- **THEN** it refuses the package as too large and reads none of its parts

### Requirement: The manifest
The manifest SHALL hold the plugin's model card, its publisher (a display
name and a 32-byte Ed25519 public key), the sha256 digest of its code as a
`urn:sha256:` URN, the model files it may download, and the time it was
signed in RFC 3339. The card's version SHALL be a semantic version
(`MAJOR.MINOR.PATCH`).

#### Scenario: A manifest without a version
- **WHEN** A4 reads a package whose card has the version "latest"
- **THEN** it refuses the package and says the version must look like 1.2.3

### Requirement: The signature
A package SHALL be accepted only when its signature verifies, with the
manifest's own publisher key, over the manifest bytes exactly as stored.
Changing any byte of the manifest or the signature SHALL make the package
fail.

#### Scenario: One byte changed in the manifest
- **GIVEN** a valid package
- **WHEN** one byte of its manifest is changed
- **THEN** A4 refuses the package because the signature doesn't match

#### Scenario: A signature from another key
- **WHEN** a manifest names publisher key A but was signed with key B
- **THEN** A4 refuses the package

### Requirement: The code matches its digest
A package SHALL be accepted only when the sha256 digest of its code equals
the digest in its signed manifest. The code SHALL be checked against that
digest every time it is loaded to run, not only when it is installed.

#### Scenario: Code swapped after signing
- **GIVEN** a valid package
- **WHEN** its code is replaced with other code and the manifest and signature are kept
- **THEN** A4 refuses the package because the code doesn't match its digest

### Requirement: Model files by digest
Each model file in the manifest SHALL give an HTTPS URL, a size in bytes, and
a sha256 URN. The sizes SHALL add up to the card's download size. A
downloaded file SHALL be used only when its size and digest match the
manifest.

#### Scenario: Download sizes that don't add up
- **WHEN** a card declares 4,000,000 download bytes and its manifest lists one file of 3,000,000 bytes
- **THEN** A4 refuses the package

#### Scenario: A file that changed on its server
- **GIVEN** an installed plugin whose model file is listed with digest D
- **WHEN** the file downloaded from its URL hashes to anything other than D
- **THEN** A4 discards it, keeps nothing, and reports that the file didn't match

### Requirement: Cards a package may carry
A packaged card SHALL pass every check the host makes on bundled cards. Its
id SHALL use only lowercase letters, digits, dots, and hyphens, in at most 64
characters. It SHALL declare only Score, Transform, or both, and run in the
browser or on a remote service. A remote card SHALL name one destination as
a plain hostname: no scheme, port, path, wildcard, or IP address.

#### Scenario: A wildcard destination
- **WHEN** a packaged card says it sends text to `*.example.com`
- **THEN** A4 refuses the package and says the card must name one host

#### Scenario: An id with other characters
- **WHEN** a packaged card's id is `Example/Word Length`
- **THEN** A4 refuses the package and says which characters an id may use

#### Scenario: An operation a package can't carry
- **WHEN** a packaged card declares Generate
- **THEN** A4 refuses the package and says installed plugins may score and transform only

### Requirement: The publisher's fingerprint
A publisher's fingerprint SHALL be the SHA-256 of their raw public key, shown
as its first 16 bytes in 8 groups of 4 hexadecimal digits. The fingerprint
SHALL be shown wherever the publisher is named: by `a4 plugin verify`, in the
install dialog, and in the Models section.

#### Scenario: The same key, the same fingerprint
- **WHEN** two packages are signed with the same key under different publisher names
- **THEN** both show the same fingerprint

### Requirement: The protocol a plugin speaks
A plugin's code SHALL run as a dedicated worker and serve `SheetModelService`
over the message port it is given, with every message an `a4.v1.RpcFrame`.
This is the same protocol the bundled in-browser plugin uses. The plugin
SHALL describe itself with the card in its manifest.

#### Scenario: A plugin that describes itself as another plugin
- **GIVEN** an installed plugin whose manifest card has the id `example.word-length`
- **WHEN** its code describes itself with the id `example.other`
- **THEN** the host refuses every call to it and reports the mismatch

### Requirement: Making a signing key
`a4 plugin keygen <file>` SHALL write a new Ed25519 private key to `<file>`,
readable only by its owner, and print the public key and its fingerprint. It
SHALL never print the private key. It SHALL refuse to overwrite an existing
file and exit 2.

#### Scenario: A key file that already exists
- **GIVEN** `publisher.key` exists
- **WHEN** the publisher runs `a4 plugin keygen publisher.key`
- **THEN** the file is unchanged, and the command says so and exits 2

### Requirement: Packing a plugin
`a4 plugin pack` SHALL build a package from a card file, a code file, a key
file, a publisher name, and any model files (each a local file and the HTTPS
URL it will be served from). It SHALL compute every digest and size itself,
check the card as A4 will when installing, sign the manifest, and write the
package. It SHALL never run the plugin's code.

#### Scenario: Packing and verifying
- **WHEN** a publisher packs the Hard wrap example and then runs `a4 plugin verify` on the result
- **THEN** verify reports a valid package, with the publisher's name and fingerprint, and exits 0

#### Scenario: A card A4 would refuse
- **WHEN** a publisher packs a card that declares Generate
- **THEN** no package is written, and the command names the problem and exits 1

### Requirement: Verifying a package
`a4 plugin verify <file>` SHALL check a package as A4 does before installing:
size, signature, code digest, card, and model file list. It SHALL print the
plugin's name, version, operations, where it sends text, its download size,
the publisher's name and fingerprint, and whether that key is on A4's
known-publisher list. It SHALL exit 0 when the package is valid, 1 when it
isn't, and 2 for a usage error, and it SHALL never run the plugin's code.

#### Scenario: A tampered package
- **WHEN** the publisher runs `a4 plugin verify` on a package whose code was changed after signing
- **THEN** it says the code doesn't match its digest and exits 1
