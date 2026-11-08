import os
import sys
from pathlib import Path

def remove_js_comments(content: str) -> str:
    """
    Removes single-line (//) and multi-line (/* ... */) comments from JavaScript code
    while safely preserving strings, template literals, regular expression literals, 
    and avoiding leftover blank lines from full-line comments.
    """
    out = []
    i = 0
    n = len(content)
    
    in_string = None
    in_line_comment = False
    in_block_comment = False
    in_regex = False
    in_char_class = False
    escaped = False
    last_non_ws = None

    expression_starters = {
        '=', '(', '{', '[', ',', ':', ';', '?', '!', '&', '|', 
        '+', '-', '*', '%', '^', '~', '<', '>', '\n'
    }

    while i < n:
        char = content[i]
        
        if not in_string and not in_regex:
            if in_line_comment:
                if char == '\n':
                    in_line_comment = False
                    # Check if this full-line comment was preceded only by whitespace on the same line.
                    # If so, drop the newline to prevent leaving a blank gap.
                    if out and out[-1] in (' ', '\t', '\r'):
                        # Scan backwards to see if the start of the line was hit
                        j = len(out) - 1
                        while j >= 0 and out[j] in (' ', '\t', '\r'):
                            j -= 1
                        if j < 0 or out[j] == '\n':
                            # It was a dedicated comment line. Truncate the leading indentation.
                            del out[j+1:]
                            i += 1
                            continue
                    
                    out.append(char)
                    last_non_ws = '\n'
                i += 1
                continue
            
            if in_block_comment:
                if char == '*' and i + 1 < n and content[i + 1] == '/':
                    in_block_comment = False
                    i += 2
                    
                    # Optional cleanup for block comments that occupied their own line
                    if out and out[-1] == '\n':
                        j = len(out) - 2
                        while j >= 0 and out[j] in (' ', '\t', '\r'):
                            j -= 1
                        if j >= 0 and out[j] == '\n':
                            # Drop the extra leading newline if it sat alone on a line
                            out.pop()
                else:
                    i += 1
                continue

            # Check for comment starts
            if char == '/' and i + 1 < n:
                if content[i + 1] == '/':
                    in_line_comment = True
                    i += 2
                    continue
                elif content[i + 1] == '*':
                    in_block_comment = True
                    i += 2
                    continue

            # Check for string literal start
            if char in ("'", '"', '`'):
                in_string = char
                out.append(char)
                last_non_ws = char
                escaped = False
                i += 1
                continue

            # Check for regex literal start
            if char == '/':
                is_regex = (last_non_ws in expression_starters or last_non_ws is None)
                if is_regex:
                    in_regex = True
                    in_char_class = False
                    escaped = False
                    out.append(char)
                    last_non_ws = char
                    i += 1
                    continue

        elif in_string:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == in_string:
                in_string = None
            
            out.append(char)
            last_non_ws = char if not char.isspace() else last_non_ws
            i += 1
            continue

        elif in_regex:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif not escaped:
                if char == '[' and not in_char_class:
                    in_char_class = True
                elif char == ']' and in_char_class:
                    in_char_class = False
                elif char == '/' and not in_char_class:
                    in_regex = False
                    out.append(char)
                    last_non_ws = char
                    i += 1
                    while i < n and content[i].isalpha():
                        out.append(content[i])
                        i += 1
                    continue

            out.append(char)
            last_non_ws = char if not char.isspace() else last_non_ws
            i += 1
            continue

        out.append(char)
        if not char.isspace():
            last_non_ws = char
        i += 1

    return "".join(out)

def process_directory(directory_path: str):
    target_dir = Path(directory_path)
    if not target_dir.is_dir():
        print(f"Error: '{directory_path}' is not a valid directory.")
        sys.exit(1)

    js_files = list(target_dir.rglob("*.js"))
    if not js_files:
        print(f"No .js files found in {directory_path}")
        return

    print(f"Found {len(js_files)} JavaScript file(s). Processing...")

    for file_path in js_files:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                original_content = f.read()
            
            cleaned_content = remove_js_comments(original_content)
            
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(cleaned_content)
                
            print(f"Successfully cleaned: {file_path}")
        except Exception as e:
            print(f"Error processing {file_path}: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python remove_comments.py <directory_path>")
        sys.exit(1)
    
    process_directory(sys.argv[1])