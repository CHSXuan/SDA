#pragma once
#include "oar.h"
#include "oar_metadata.h"
void sda_capture_audio(unsigned id, const oar_audio_block_t *block);
void sda_capture_position(unsigned id, unsigned offset, unsigned duration, const oar_metadata_t *md);
void sda_no_object(void);
oar_audio_block_t *sda_current_object(void);

void sda_capture_trim(unsigned n);
