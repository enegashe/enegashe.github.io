# Get the root directory
$root = Get-Location

# Define the output file path
$outputFile = Join-Path -Path $root -ChildPath "file_contents.txt"
$outputFileName = "file_contents.txt"

# Create or clear the output file
"File contents from repository (excluding static folder)" | Out-File -FilePath $outputFile
"Root directory: $root" | Out-File -FilePath $outputFile -Append

# First, list all files found to verify what we're working with
"Files found in repository:" | Out-File -FilePath $outputFile -Append
Get-ChildItem -Recurse -File | ForEach-Object {
    "  - $($_.FullName)" | Out-File -FilePath $outputFile -Append
}

# Add separator before the actual content
"`n====================CONTENT START====================`n" | Out-File -FilePath $outputFile -Append

# Use absolute paths throughout to avoid working directory issues
# Get all files recursively excluding those in any "static" folder AND the output file
Get-ChildItem -Path $root -Recurse -File | Where-Object { 
    $_.FullName -notmatch "\\static\\" -and 
    $_.Name -ne $outputFileName 
} | ForEach-Object {
    # Compute relative path
    $relativePath = $_.FullName.Substring($root.Path.Length + 1)
    
    # Write file header with relative path
    "===== $relativePath =====" | Out-File -FilePath $outputFile -Append
    
    # Write file content
    Get-Content -Path $_.FullName -Raw | Out-File -FilePath $outputFile -Append
    
    # Add a separator between files
    "`n--------------------------`n" | Out-File -FilePath $outputFile -Append
}

Write-Host "File contents have been written to: $outputFile"
