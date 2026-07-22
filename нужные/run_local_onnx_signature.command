#!/bin/zsh
cd "$(dirname "$0")"

if [ -x ".venv312/bin/python" ]; then
  PYTHON=".venv312/bin/python"
else
  PYTHON="python3"
fi

"$PYTHON" local_onnx_signature.py "$@"
echo
echo "Press any key to close..."
read -k 1
