#include <stdlib.h>
#include <string.h>
#include "IAMF_decoder.h"
#include "bridge.h"

typedef struct {unsigned id; oar_audio_block_t block;} Capture;
static unsigned trim;
void sda_capture_trim(unsigned n){trim=n;}
static Capture *captures; static unsigned count, capacity;
static float *events; static unsigned event_count,event_capacity;
static IAMF_DecoderHandle decoder;
static unsigned char *input; static unsigned input_capacity;
static int32_t *output; static int configured, error, used, samples, current=-1;
static void clear_frame(void){for(unsigned i=0;i<count;i++)free(captures[i].block.data);count=0;event_count=0;current=-1;error=0;trim=0;}
void sda_no_object(void){current=-1;}
oar_audio_block_t *sda_current_object(void){return current<0?NULL:&captures[current].block;}
void sda_capture_audio(unsigned id,const oar_audio_block_t *b){
 if(count==capacity){unsigned next=capacity?capacity*2:8;void *p=realloc(captures,next*sizeof(Capture));if(!p){error=-100;return;}captures=p;capacity=next;}
 Capture *c=&captures[count];c->id=id;c->block=*b;c->block.data=malloc((size_t)b->channels*b->samples_per_channel*sizeof(float));
 if(!c->block.data){error=-100;return;}memcpy(c->block.data,b->data,(size_t)b->channels*b->samples_per_channel*sizeof(float));current=count++;
}
void sda_capture_position(unsigned id,unsigned offset,unsigned duration,const oar_metadata_t *md){
 if(md->object_positions.position_type!=ck_polar){error=-101;return;}
 for(unsigned i=0;i<md->object_positions.num_objects;i++){
  if(event_count==event_capacity){unsigned next=event_capacity?event_capacity*2:64;void *p=realloc(events,next*7*sizeof(float));if(!p){error=-100;return;}events=p;event_capacity=next;}
  polar_t p=md->object_positions.polar_positions[i];float *e=events+7*event_count++;
  memcpy(e,&id,sizeof(id));e[1]=i;e[2]=offset;e[3]=duration;e[4]=p.azimuth;e[5]=p.elevation;e[6]=p.distance;
 }
}
void sda_close(void){if(decoder)IAMF_decoder_close(decoder);decoder=NULL;clear_frame();free(output);output=NULL;configured=0;free(input);input=NULL;input_capacity=0;free(events);events=NULL;event_capacity=0;free(captures);captures=NULL;capacity=0;}
int sda_open(void){sda_close();decoder=IAMF_decoder_open();if(!decoder)return -100;IAMF_decoder_set_profile(decoder,5);IAMF_decoder_output_layout_set_sound_system(decoder,9);IAMF_decoder_set_bit_depth(decoder,32);IAMF_decoder_peak_limiter_enable(decoder,0);return 0;}
unsigned char *sda_input(unsigned n){if(n>input_capacity){void *p=realloc(input,n);if(!p)return NULL;input=p;input_capacity=n;}return input;}
int sda_decode(unsigned n){
 clear_frame();used=0;samples=0;unsigned consumed=0;
 if(!configured){int r=IAMF_decoder_configure(decoder,input,n,&consumed);used=consumed;if(r!=0)return r;
  IAMF_StreamInfo *info=IAMF_decoder_get_stream_info(decoder);if(!info)return -100;
  output=malloc((size_t)info->max_frame_size*12*sizeof(int32_t));IAMF_decoder_free_stream_info(info);if(!output)return -100;configured=1;
  return 0;
 }
 samples=IAMF_decoder_decode(decoder,n?input:NULL,n,&consumed,output);used=consumed;
 return error?error:(samples<0?samples:0);
}
int sda_info(int k){switch(k){case 0:return used;case 1:return samples;case 2:return count;case 3:return event_count;case 4:return configured;case 5:return trim;}return 0;}
int sda_object_info(int i,int k){if(i<0||(unsigned)i>=count)return 0;Capture*c=&captures[i];return k==0?c->id:k==1?c->block.channels:c->block.samples_per_channel;}
float *sda_object_pcm(int i){return captures[i].block.data;}
float *sda_events(void){return events;}
int32_t *sda_output(void){return output;}
