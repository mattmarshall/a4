# Spec Delta

## MODIFIED Requirements

### Requirement: Download page text
The system SHALL download the active page as a UTF-8 .md file holding exactly
the page text, named after the page (lowercase, hyphen-separated, at most 48
characters), or "a4-page.md" when no name can be derived.

#### Scenario: Named download
- **WHEN** the open page is named "INCIDENT INC-2291 · Checkout latency"
- **THEN** the downloaded file is named "incident-inc-2291-checkout-latency.md"
