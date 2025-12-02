#!/bin/bash
set -e

cd /Users/michaelreoch/aitradr

# Initialize git if not already done
if [ ! -d .git ]; then
    echo "Initializing git repository..."
    git init
    git branch -M main
fi

# Add all files
echo "Adding files..."
git add .

# Check if there are changes to commit
if git diff --staged --quiet; then
    echo "No changes to commit"
else
    echo "Committing changes..."
    git commit -m "Initial Next.js setup"
fi

# Set up remote
if git remote get-url origin >/dev/null 2>&1; then
    echo "Updating remote URL..."
    git remote set-url origin https://github.com/Mreoch1/aitradr.git
else
    echo "Adding remote..."
    git remote add origin https://github.com/Mreoch1/aitradr.git
fi

# Show remote
echo "Remote configured:"
git remote -v

echo ""
echo "Ready to push. Run: git push -u origin main"

