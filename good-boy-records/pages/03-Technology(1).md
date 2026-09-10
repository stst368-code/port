---
tab: Tech
title: The tools and tech used
order: 3
---

Below is a quick overview of the tools and technologies used to build the
workflow, design the music, set up this website and construct its contents.

### Languages

- [Python](https://www.python.org/)

### Software

- [PyCharm](https://www.jetbrains.com/pycharm/)
- [ComfyUI](https://github.com/comfy-org/comfyui)
- [Notepad++](https://notepad-plus-plus.org/)

### AI

- [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5)
- [MiniMax Music 3](https://github.com/MiniMax-AI/MiniMax-Music3)
	Text Encoders:
		[minimax_music3_text_encoder_bf16.safetensors](https://huggingface.co/Comfy-Org/MiniMax-Music-3/blob/main/text_encoders/minimax_music3_text_encoder_bf16.safetensors)
		[minimax_music3_text_encoder_pruned_bf16.safetensors](https://huggingface.co/Comfy-Org/MiniMax-Music-3/blob/main/text_encoders/minimax_music3_text_encoder_pruned_bf16.safetensors)
		[minimax_music3_text_encoder_pruned_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-Music-3/blob/main/text_encoders/minimax_music3_text_encoder_pruned_int8_convrot.safetensors)
	Diffusion Transformers:
		[minimax_music3_dit_fp16.safetensors](https://huggingface.co/Comfy-Org/MiniMax-Music-3/blob/main/diffusion_models/minimax_music3_dit_fp16.safetensors)
		[minimax_music3_dit_fp32.safetensors](https://huggingface.co/Comfy-Org/MiniMax-Music-3/blob/main/diffusion_models/minimax_music3_dit_fp32.safetensors)
		[minimax_music3_dit_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/MiniMax-Music-3/blob/main/diffusion_models/minimax_music3_dit_int8_convrot.safetensors)
	VAE:
		[minimax_music3_dav.safetensors](https://huggingface.co/Comfy-Org/MiniMax-Music-3/blob/main/vae/minimax_music3_dav.safetensors)
- [Whisper](https://huggingface.co/openai/whisper-large-v3)
- [Demucs](https://github.com/adefossez/demucs)

### Services

- [RunPod](https://www.runpod.io/)
- [GitHub](https://github.com/) (you're here!)

### Data storage formats

- `.yaml`
- `.json`
- `.md`
