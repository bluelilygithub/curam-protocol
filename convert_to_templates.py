import os
import re
from pathlib import Path

# Conversion script for industry pages to Jinja2 templates

def extract_metadata(html_content):
    """Extract title and description from HTML"""
    title_match = re.search(r'<title>(.*?)</title>', html_content)
    desc_match = re.search(r'<meta name="description" content="(.*?)"', html_content)
    
    title = title_match.group(1) if title_match else "Curam-Ai Protocol"
    description = desc_match.group(1) if desc_match else "AI automation for professional services"
    
    return title, description

def extract_body_content(html_content):
    """Extract content between opening <body> tag and footer placeholder"""
    # Find content after navbar and before footer
    # Remove the scroll button, navbar placeholder, and footer/scripts
    
    # Remove everything before first <section>
    section_start = html_content.find('<section')
    if section_start == -1:
        return ""
    
    # Remove everything after and including footer placeholder
    footer_start = html_content.find('<div id="footer-placeholder">')
    if footer_start == -1:
        footer_start = html_content.find('</body>')
    
    body_content = html_content[section_start:footer_start].strip()
    
    # Replace asset paths with url_for
    body_content = re.sub(r'href="\.\./assets/', r'href="{{ url_for(\'static\', filename=\'', body_content)
    body_content = re.sub(r'src="\.\./assets/', r'src="{{ url_for(\'static\', filename=\'', body_content)
    
    # Close the url_for calls - find all occurrences and replace
    body_content = re.sub(r'{{ url_for\(\'static\', filename=\'([^\']+)\'\)\s*(["\'])', r'{{ url_for(\'static\', filename=\'\1\') }}"\2', body_content)
    
    # Replace page links with url_for
    body_content = body_content.replace('href="../contact.html"', 'href="{{ url_for(\'contact_page\') }}"')
    body_content = body_content.replace('href="../roi.html', 'href="{{ url_for(\'roi_calculator\') }}')
    body_content = body_content.replace('href="../feasibility-sprint-report.html', 'href="{{ url_for(\'feasibility_sprint_report\') }}')
    
    return body_content

def convert_to_template(input_file, output_file):
    """Convert an industry HTML file to a Jinja2 template"""
    with open(input_file, 'r', encoding='utf-8') as f:
        html_content = f.read()
    
    title, description = extract_metadata(html_content)
    body_content = extract_body_content(html_content)
    
    template = f"""{{% extends "base.html" %}}

{{% block title %}}{title}{{% endblock %}}
{{% block description %}}{description}{{% endblock %}}

{{% block content %}}
{body_content}
{{% endblock %}}
"""
    
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(template)
    
    print(f"Converted {os.path.basename(input_file)}")

# Convert all industry files
industry_files = [
    'architecture.html',
    'construction.html',
    'engineering.html',
    'government-contractors.html',
    'healthcare-admin.html',
    'insurance-underwriting.html',
    'legal-services.html',
    'logistics-freight.html',
    'mining-services.html',
    'property-management.html',
    'wealth-management.html'
]

for filename in industry_files:
    input_path = f'industries/{filename}'
    output_path = f'templates/industries/{filename}'
    
    if os.path.exists(input_path):
        convert_to_template(input_path, output_path)
    else:
        print(f"File not found: {input_path}")

print(f"\nConversion complete! Converted {len(industry_files)} files.")
print("Next steps:")
print("1. Update main.py routes to use render_template() instead of send_file()")
print("2. Rename assets/ to static/ (Flask convention)")
print("3. Test locally")

