# Feature: Data Export (CSV/PDF)

## Goal
Allow users to export their financial data (transactions, account summaries, goals) into standard, portable formats like CSV and PDF.

## Scope
1.  **API Endpoints**:
    *   `GET /export/transactions?start_date=...&end_date=...`: Returns a CSV file stream.
    *   `GET /export/summary?date_range=...`: Returns a PDF document summarizing the period.
2.  **Implementation**:
    *   **CSV**: Use Python's built-in `csv` module or Pandas to structure and stream the data.
    *   **PDF**: Use a library like `ReportLab` or `WeasyPrint` to generate a nicely formatted, branded PDF report.
3.  **Security**: Ensure that the export process respects user permissions and only exports data for the authenticated user.

## Dependencies
- Requires adding `pandas` and a PDF generation library (e.g., `reportlab`) to `pyproject.toml`.
- The API response must use `StreamingResponse` in FastAPI.