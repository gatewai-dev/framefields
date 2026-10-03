import runpod
import subprocess
import json
import sys

def handler(job):
    job_input = job['input']
    
    # Run Node.js CLI command to process the render job
    result = subprocess.run(
        ["node", "apps/gatewai-renderer/dist/src/cli.js", "--job", json.dumps(job_input)],
        capture_output=True,
        text=True
    )
    
    if result.returncode != 0:
        raise Exception(f"Node.js rendering process failed: {result.stderr or result.stdout}")
        
    try:
        # Find the JSON result line from stdout
        output_lines = result.stdout.strip().split('\n')
        for line in reversed(output_lines):
            line_str = line.strip()
            if line_str.startswith('{"success":'):
                return json.loads(line_str)
        raise Exception(f"No JSON success payload returned in Node.js output. Raw stdout: {result.stdout}")
    except Exception as e:
        raise Exception(f"Failed to parse Node.js output: {str(e)}. Raw stdout: {result.stdout}")

runpod.serverless.start({"handler": handler})
