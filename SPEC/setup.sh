#!/bin/bash

# Setup du dossier d'audit Manta
# Lance ce script une seule fois avant d'ouvrir Claude Code

set -e

echo "📦 Clonage du monorepo Medusa V2..."
git clone --depth=1 https://github.com/medusajs/medusa.git medusa-source

echo "📁 Création de la structure d'output..."
mkdir -p audit-output/phase1
mkdir -p audit-output/phase2
mkdir -p audit-output/phase3
mkdir -p audit-output/phase4

echo "📋 Packages disponibles dans medusa-source/packages/ :"
ls medusa-source/packages/

echo ""
echo "✅ Setup terminé. Ouvre ce dossier dans Claude Code et lance :"
echo "   'Lis CLAUDE.md et démarre l'audit'"
