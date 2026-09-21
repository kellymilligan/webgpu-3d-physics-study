#include "../vendor/box3d/web_bridge.c"
#include <stdio.h>
#define CHECK(c) do {if(!(c)){fprintf(stderr,"Failed line %d: %s\n",__LINE__,#c);exit(1);}}while(0)

int main(void) {
  for(int kind=0;kind<8;kind++) {
    CHECK(lab_create(1,24,18,16,.5f,1,1,42,1u<<kind,1,.45f,.12f,.08f)==1);
    LabBody* body=&bodies[0];
    if(kind==4){
      const b3HullData* hull=b3Shape_GetHull(body->shape);CHECK(hull->vertexCount==64);
      CHECK(fabsf(hull->center.y)<1e-5f);CHECK(fabsf(hull->aabb.lowerBound.y+.6f)<1e-5f);CHECK(fabsf(hull->aabb.upperBound.y-.6f)<1e-5f);
      const b3Vec3* points=b3GetHullPoints(hull);float worst=0;
      for(int i=0;i<2048;i++){
        float angle=2*B3_PI*i/2048,support=0;b3Vec3 n={cosf(angle),0,sinf(angle)};
        for(int j=0;j<hull->vertexCount;j++)support=fmaxf(support,b3Dot(n,points[j]));
        worst=fmaxf(worst,1-support/.5f);
      }
      printf("Cylinder maximum radial support error: %.6f\n",worst);CHECK(worst<.005f);
    }
    if(kind==2){
      float worst=0,p=body->shapeData[2],q=p/(p-1);
      for(int sample=0;sample<2000;sample++){
        b3Vec3 n=b3Normalize((b3Vec3){randomFloat()*2-1,randomFloat()*2-1,randomFloat()*2-1});float support=-100;
        for(int part=0;part<body->partCount;part++){
          const b3HullData* hull=b3Shape_GetHull(body->parts[part]);const b3Vec3* points=b3GetHullPoints(hull);
          for(int i=0;i<hull->vertexCount;i++)support=fmaxf(support,b3Dot(n,points[i]));
        }
        float exact=.5f*powf(powf(fabsf(n.x),q)+powf(fabsf(n.y),q)+powf(fabsf(n.z),q),1/q);
        worst=fmaxf(worst,(exact-support)/.5f);
      }
      printf("Sphube maximum sampled support error: %.4f of base size\n",worst);CHECK(worst<.02f);
    }
    for(int i=0;i<600;i++)lab_step(1.f/60,4);
    b3Pos pos=b3Body_GetPosition(body->body);b3Quat rotation=b3Body_GetRotation(body->body);float bottom=100;
    if(kind==0)bottom=pos.y-body->shapeData[1];
    else if(kind==3){b3Vec3 axis=b3RotateVector(rotation,(b3Vec3){0,body->shapeData[2],0});bottom=pos.y-fabsf(axis.y)-body->shapeData[1];}
    else {
      for(int part=0;part<body->partCount;part++){
        const b3HullData* hull=b3Shape_GetHull(body->parts[part]);const b3Vec3* points=b3GetHullPoints(hull);
        for(int i=0;i<hull->vertexCount;i++)bottom=fminf(bottom,pos.y+b3RotateVector(rotation,points[i]).y);
      }
    }
    printf("Shape %d floor separation: %.6f\n",kind,bottom);CHECK(bottom>-.02f&&bottom<.025f);
    lab_cursor(0,10,0,1,1,1.f/60);CHECK(b3Body_IsEnabled(cursorBody));CHECK(b3Length(b3Body_GetLinearVelocity(cursorBody))<.01f);
    lab_cursor(8,10,0,1,1,1.f/60);CHECK(b3Length(b3Body_GetLinearVelocity(cursorBody))<=18.001f);
    lab_cursor(0,0,0,1,0,1.f/60);CHECK(!b3Body_IsEnabled(cursorBody));
  }
  CHECK(lab_create(1000,24,18,16,.099f,8,3,42,255,1,.45f,.12f,.08f)==1000);
  puts("Default 1000-body layout placed without overlap.");
  CHECK(lab_create(1000,24,18,16,.01f,100,8,71,255,1,.45f,.12f,.08f)==1000);
  for(int i=0;i<120;i++)lab_step(1.f/60,4);
  lab_state();for(int i=0;i<bodyCount*16;i++)CHECK(isfinite(states[i]));
  puts("Mixed shapes at 100x size range remain finite.");lab_destroy();return 0;
}
