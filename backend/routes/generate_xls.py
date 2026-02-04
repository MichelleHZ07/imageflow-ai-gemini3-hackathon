#!/usr/bin/env python3
"""
Generate real BIFF8/OLE .xls files using xlwt.
This avoids the 255 character cell limit that SheetJS has.

Usage:
  python3 generate_xls.py <input_json> <output_xls>

Input JSON format:
  {
    "rows": [
      ["Header1", "Header2", ...],
      ["Value1", "Value2", ...],
      ...
    ]
  }
"""

import sys
import json
import xlwt

def generate_xls(input_json_path, output_xls_path):
    """Generate an XLS file from JSON data."""
    
    # Read input JSON
    with open(input_json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    rows = data.get('rows', [])
    
    if not rows:
        print("Error: No rows in input data", file=sys.stderr)
        sys.exit(1)
    
    # Create workbook and sheet
    workbook = xlwt.Workbook(encoding='utf-8')
    sheet = workbook.add_sheet('Sheet1')
    
    # Write rows
    for row_idx, row in enumerate(rows):
        for col_idx, cell_value in enumerate(row):
            # Convert to string, handle None
            if cell_value is None:
                cell_value = ''
            else:
                cell_value = str(cell_value)
            
            # xlwt can handle long strings (up to 32767 chars in BIFF8)
            sheet.write(row_idx, col_idx, cell_value)
    
    # Save workbook
    workbook.save(output_xls_path)
    
    print(f"Generated XLS with {len(rows)} rows")

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input_json> <output_xls>", file=sys.stderr)
        sys.exit(1)
    
    input_json = sys.argv[1]
    output_xls = sys.argv[2]
    
    try:
        generate_xls(input_json, output_xls)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)