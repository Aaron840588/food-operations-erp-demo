import shutil, os

src = r'c:\Users\aaron\.gemini\antigravity\scratch\H-H-main\frontend\public\hh-logo.png'

# Next.js App Router reads favicon from app/ directory directly
dst_app = r'c:\Users\aaron\.gemini\antigravity\scratch\H-H-main\frontend\src\app\favicon.ico'
dst_icon = r'c:\Users\aaron\.gemini\antigravity\scratch\H-H-main\frontend\src\app\icon.png'
dst_apple = r'c:\Users\aaron\.gemini\antigravity\scratch\H-H-main\frontend\src\app\apple-icon.png'

# Copy as favicon.ico (modern browsers accept PNG served as .ico)
shutil.copy2(src, dst_app)
print(f"Copied to {dst_app}")

# Also copy as icon.png and apple-icon.png (Next.js App Router special file convention)
shutil.copy2(src, dst_icon)
print(f"Copied to {dst_icon}")

shutil.copy2(src, dst_apple)
print(f"Copied to {dst_apple}")

print("Done. All favicon files in place.")
