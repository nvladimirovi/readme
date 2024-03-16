import sys

model = YourTTSModel()
# model.cuda()

print("Inference...")

while True:
    # Read data from standard input
    [text, output_path] = sys.stdin.readline().strip().split("@@")
    try:
        out = model.inference(
            text,
            "en"
        )
        output_path = out.to_wav(output_path)
        
        # !!! Keep the prints here stdout/stderr is used for process communication
        print(output_path)
        print("done")
        # Flush the output to ensure it's immediately sent
        sys.stdout.flush()
    except Exception as e:
        # !!! Keep the prints here stdout/stderr is used for process communication
        print(text)
        print("error")