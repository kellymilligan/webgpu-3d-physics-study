#include "box3d/box3d.h"
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct LabBody {
	b3BodyId body;
	b3ShapeId shape;
	b3ShapeId parts[6];
	int partCount;
	float bound;
	float shapeData[4];
} LabBody;

static b3WorldId world = {0};
static LabBody* bodies;
static float* states;
static int bodyCount;
static b3BodyId cursorBody = {0};
static b3ShapeId cursorShape = {0};
static float cursorRadius;
static b3ShapeId walls[6];
static int wallCount;
static float currentFriction, currentRestitution, currentDensity, currentDamping;
static float maxShapeHalf;
static uint32_t randomState;

static uint32_t nextRandom(void) {
	uint32_t x = randomState;
	x ^= x << 13; x ^= x >> 17; x ^= x << 5;
	randomState = x;
	return x;
}
static float randomFloat(void) { return (float)(nextRandom() >> 8) / 16777216.0f; }

static b3Quat randomRotation(void) {
	float u1 = randomFloat(), u2 = randomFloat(), u3 = randomFloat();
	float a = sqrtf(1.0f - u1), b = sqrtf(u1);
	float p = 2.0f * B3_PI * u2, q = 2.0f * B3_PI * u3;
	return (b3Quat){{a * sinf(p), a * cosf(p), b * sinf(q)}, b * cosf(q)};
}

static float max3(float a, float b, float c) { return fmaxf(a, fmaxf(b, c)); }

static b3ShapeId createShape(b3BodyId body, int type, float size, float* data, float* bound, LabBody* item) {
	b3ShapeDef def = b3DefaultShapeDef();
	def.density = currentDensity;
	def.baseMaterial.friction = currentFriction;
	def.baseMaterial.restitution = currentRestitution;
	data[0] = (float)type;
	b3ShapeId result = {0};
	if (type == 0) {
		b3Sphere sphere = {{0, 0, 0}, size};
		data[1] = size; data[2] = size; data[3] = size; *bound = size;
		result = b3CreateSphereShape(body, &def, &sphere);
	} else if (type == 1) {
		b3BoxHull hull = b3MakeCubeHull(size);
		data[1] = size; data[2] = size; data[3] = size; *bound = sqrtf(3.0f) * size;
		result = b3CreateHullShape(body, &def, &hull.base);
	} else if (type == 2) {
		// Six non-overlapping convex sectors give a 218-vertex approximation of
		// the p=3.43184 Lp ball while respecting Box3D's per-hull edge limit.
		const float exponent=3.43184f;
		for(int face=0;face<6;face++) {
			b3Vec3 points[50]={{0,0,0}};int count=1,axis=face/2;
			for(int a=-3;a<=3;a++)for(int b=-3;b<=3;b++) {
				float v[3];v[axis]=(face%2)?1:-1;v[(axis+1)%3]=a/3.f;v[(axis+2)%3]=b/3.f;
				float scale=size/powf(powf(fabsf(v[0]),exponent)+powf(fabsf(v[1]),exponent)+powf(fabsf(v[2]),exponent),1/exponent);
				points[count++]=(b3Vec3){v[0]*scale,v[1]*scale,v[2]*scale};
			}
			b3HullData* hull=b3CreateHull(points,count,count);
			item->parts[item->partCount++]=b3CreateHullShape(body,&def,hull);b3DestroyHull(hull);
		}
		data[1]=size;data[2]=exponent;data[3]=0;*bound=powf(3,.5f-1/exponent)*size;
		result=item->parts[0];
	} else if (type == 3) {
		float radius = size * 0.55f, halfSegment = size * 1.15f;
		b3Capsule capsule = {{0, -halfSegment, 0}, {0, halfSegment, 0}, radius};
		data[1] = radius; data[2] = halfSegment; data[3] = 0; *bound = radius + halfSegment;
		result = b3CreateCapsuleShape(body, &def, &capsule);
	} else if (type == 4) {
		float radius = size, halfHeight = size * 1.2f;
		// Rendering is an exact circular cylinder. Box3D's maximum 32-sided
		// cylinder hull stays within 0.482% of that radius for collision.
		b3HullData* hull = b3CreateCylinder(2.0f * halfHeight, radius, -halfHeight, 32);
		data[1] = radius; data[2] = halfHeight; data[3] = 0; *bound = sqrtf(radius * radius + halfHeight * halfHeight);
		result = b3CreateHullShape(body, &def, hull); b3DestroyHull(hull);
	} else if (type == 5) {
		float k = size / sqrtf(3.0f);
		b3Vec3 points[4] = {{k,k,k},{-k,-k,k},{-k,k,-k},{k,-k,-k}};
		b3HullData* hull = b3CreateHull(points, 4, 4);
		data[1] = size; data[2] = 0; data[3] = 0; *bound = size;
		result = b3CreateHullShape(body, &def, hull); b3DestroyHull(hull);
	} else if (type == 6) {
		b3Vec3 points[6] = {{size,0,0},{-size,0,0},{0,size,0},{0,-size,0},{0,0,size},{0,0,-size}};
		b3HullData* hull = b3CreateHull(points, 6, 6);
		data[1] = size; data[2] = 0; data[3] = 0; *bound = size;
		result = b3CreateHullShape(body, &def, hull); b3DestroyHull(hull);
	} else {
		float length = 2.0f + 8.0f * randomFloat();
		size = fminf(size, maxShapeHalf / length);
		float hx = size, hy = size, hz = size * length;
		b3BoxHull hull = b3MakeBoxHull(hx, hy, hz);
		data[1] = hx; data[2] = hy; data[3] = hz; *bound = sqrtf(hx*hx + hy*hy + hz*hz);
		result = b3CreateHullShape(body, &def, &hull.base);
	}
	if(type!=2){item->parts[0]=result;item->partCount=1;}
	return result;
}

static void createWall(float x, float y, float z, float hx, float hy, float hz) {
	b3BodyDef bodyDef = b3DefaultBodyDef(); bodyDef.position = (b3Pos){x,y,z};
	b3BodyId body = b3CreateBody(world, &bodyDef);
	b3ShapeDef shapeDef = b3DefaultShapeDef();
	shapeDef.baseMaterial.friction = currentFriction; shapeDef.baseMaterial.restitution = currentRestitution;
	b3BoxHull box = b3MakeBoxHull(hx,hy,hz); walls[wallCount++] = b3CreateHullShape(body, &shapeDef, &box.base);
}

__attribute__((used)) void lab_destroy(void) {
	if (b3World_IsValid(world)) b3DestroyWorld(world);
	world = (b3WorldId){0}; free(bodies); free(states); bodies = NULL; states = NULL; bodyCount = 0; wallCount = 0;
}

static int largestFirst(const void* a, const void* b) {
	float delta = ((const LabBody*)b)->bound - ((const LabBody*)a)->bound;
	return (delta > 0) - (delta < 0);
}

__attribute__((used)) int lab_create(int count, float width, float height, float depth, float baseSize,
	float variation, float bias, uint32_t seed, uint32_t typeMask, float density, float friction, float restitution, float damping) {
	lab_destroy(); if (count < 1 || typeMask == 0) return 0;
	bodyCount = count; randomState = seed ? seed : 1; currentDensity = density; currentFriction = friction;
	currentRestitution = restitution; currentDamping = damping;
	maxShapeHalf = fminf(width, fminf(height, depth)) * 0.22f;
	bodies = calloc((size_t)count, sizeof(LabBody)); states = calloc((size_t)count * 16, sizeof(float));
	if (!bodies || !states) { lab_destroy(); return 0; }
	b3WorldDef worldDef = b3DefaultWorldDef(); worldDef.gravity = (b3Vec3){0,-9.81f,0}; worldDef.maximumLinearSpeed = 200.0f;
	world = b3CreateWorld(&worldDef);
	float wall = 1.0f;
	createWall(0,-wall,0,width*.5f+wall,wall,depth*.5f+wall);
	createWall(0,height+wall,0,width*.5f+wall,wall,depth*.5f+wall);
	createWall(-width*.5f-wall,height*.5f,0,wall,height*.5f,depth*.5f+wall);
	createWall(width*.5f+wall,height*.5f,0,wall,height*.5f,depth*.5f+wall);
	createWall(0,height*.5f,-depth*.5f-wall,width*.5f, height*.5f,wall);
	createWall(0,height*.5f, depth*.5f+wall,width*.5f, height*.5f,wall);

	int enabled[8], enabledCount = 0; for (int i=0;i<8;i++) if (typeMask & (1u<<i)) enabled[enabledCount++] = i;
	int nx = (int)ceilf(sqrtf((float)count * width / fmaxf(depth, 0.1f)));
	int nz = (count + nx - 1) / nx; float sx = width / fmaxf((float)nx,1), sz = depth / fmaxf((float)nz,1);
	for (int i=0;i<count;i++) {
		int type = enabled[nextRandom() % (uint32_t)enabledCount];
		float u = powf(randomFloat(), fmaxf(0.05f,bias));
		float size = baseSize * (1.0f + (fmaxf(1.0f,variation)-1.0f)*u);
		// Keep every body inside at creation; extreme settings still retain their distribution until bounded by the box itself.
		size = fminf(size, maxShapeHalf);
		b3BodyDef bodyDef = b3DefaultBodyDef(); bodyDef.type = b3_dynamicBody;
		bodyDef.linearDamping = damping; bodyDef.angularDamping = damping * .5f; bodyDef.rotation = randomRotation();
		float x = -width*.5f + (fmodf((float)i,(float)nx)+.5f)*sx + (randomFloat()-.5f)*sx*.35f;
		float z = -depth*.5f + ((float)(i/nx)+.5f)*sz + (randomFloat()-.5f)*sz*.35f;
		float y = height*.35f + randomFloat()*height*.55f;
		bodyDef.position = (b3Pos){x,y,z}; bodyDef.angularVelocity=(b3Vec3){randomFloat()-.5f,randomFloat()-.5f,randomFloat()-.5f};
		bodies[i].body = b3CreateBody(world,&bodyDef);
		bodies[i].shape = createShape(bodies[i].body,type,size,bodies[i].shapeData,&bodies[i].bound,&bodies[i]);
		float margin=fminf(bodies[i].bound,fminf(width,depth)*.45f);
		b3Pos inside={fmaxf(-width*.5f+margin,fminf(width*.5f-margin,x)),fmaxf(margin,fminf(height-margin,y)),fmaxf(-depth*.5f+margin,fminf(depth*.5f-margin,z))};
		b3Body_SetTransform(bodies[i].body,inside,bodyDef.rotation);
	}
	// Large bodies go first. Use bounding spheres only as a broad phase, then
	// Box3D's exact convex overlap query so long boxes can fit between neighbors.
	qsort(bodies, count, sizeof(LabBody), largestFirst);
	for (int i=0;i<count;i++) {
		float r=bodies[i].bound + .002f;
		b3Vec3 points[6][128];b3ShapeProxy proxies[6];
		LabBody* item=&bodies[i];int type=(int)item->shapeData[0];
		b3Quat rotation=b3Body_GetRotation(item->body);
		for(int part=0;part<item->partCount;part++){
			int pointCount=0;float proxyRadius=.002f;
			if(type==0){points[part][pointCount++]=(b3Vec3){0,0,0};proxyRadius+=item->shapeData[1];}
			else if(type==3){points[part][pointCount++]=(b3Vec3){0,-item->shapeData[2],0};points[part][pointCount++]=(b3Vec3){0,item->shapeData[2],0};proxyRadius+=item->shapeData[1];}
			else{const b3HullData* hull=b3Shape_GetHull(item->parts[part]);pointCount=hull->vertexCount;memcpy(points[part],b3GetHullPoints(hull),pointCount*sizeof(b3Vec3));}
			for(int j=0;j<pointCount;j++)points[part][j]=b3RotateVector(rotation,points[part][j]);
			proxies[part]=(b3ShapeProxy){points[part],pointCount,proxyRadius};
		}
		bool placed=false;
		for (int attempt=0;attempt<3000;attempt++) {
			b3Pos p={(-width*.5f+r)+randomFloat()*(width-2*r),r+randomFloat()*(height-2*r),(-depth*.5f+r)+randomFloat()*(depth-2*r)};
			bool clear=2*r<width && 2*r<height && 2*r<depth;
			for(int j=0;j<i && clear;j++) {
				b3Pos other=b3Body_GetPosition(bodies[j].body);
				float dx=p.x-other.x,dy=p.y-other.y,dz=p.z-other.z,sum=r+bodies[j].bound+.002f;
				if(dx*dx+dy*dy+dz*dz<sum*sum)for(int part=0;part<item->partCount&&clear;part++)clear=!b3Body_OverlapShape(bodies[j].body,p,&proxies[part],b3DefaultQueryFilter(),b3Body_GetTransform(bodies[j].body));
			}
			if(clear){b3Body_SetTransform(bodies[i].body,p,b3Body_GetRotation(bodies[i].body));placed=true;break;}
		}
		if(!placed){lab_destroy();return -1;}
	}
	// The cursor is a kinematic sphere so it pushes bodies through Box3D contacts.
	b3BodyDef cursorDef = b3DefaultBodyDef(); cursorDef.type = b3_kinematicBody; cursorDef.isEnabled=false;
	cursorBody=b3CreateBody(world,&cursorDef); b3ShapeDef cursorShapeDef=b3DefaultShapeDef();
	b3Sphere cursor={{0,0,0},1}; cursorShape=b3CreateSphereShape(cursorBody,&cursorShapeDef,&cursor); cursorRadius=1;
	return count;
}

__attribute__((used)) void lab_config(float gravity, float density, float friction, float restitution, float damping) {
	if (!b3World_IsValid(world)) return; b3World_SetGravity(world,(b3Vec3){0,-gravity,0});
	if (density==currentDensity && friction==currentFriction && restitution==currentRestitution && damping==currentDamping) return;
	for(int i=0;i<bodyCount;i++) {
		for(int j=0;j<bodies[i].partCount;j++){
			if (density!=currentDensity) b3Shape_SetDensity(bodies[i].parts[j],density,true);
			if (friction!=currentFriction) b3Shape_SetFriction(bodies[i].parts[j],friction);
			if (restitution!=currentRestitution) b3Shape_SetRestitution(bodies[i].parts[j],restitution);
		}
		if (damping!=currentDamping){b3Body_SetLinearDamping(bodies[i].body,damping);b3Body_SetAngularDamping(bodies[i].body,damping*.5f);}
	}
	for(int i=0;i<wallCount;i++) {
		b3Shape_SetFriction(walls[i],friction);
		b3Shape_SetRestitution(walls[i],restitution);
	}
	currentDensity=density;currentFriction=friction;currentRestitution=restitution;currentDamping=damping;
}

__attribute__((used)) void lab_cursor(float x,float y,float z,float radius,int active,float dt) {
	if (!b3Body_IsValid(cursorBody)) return;
	if (!active) {
		if(b3Body_IsEnabled(cursorBody))b3Body_Disable(cursorBody);
		b3Body_SetLinearVelocity(cursorBody,(b3Vec3){0,0,0});
		return;
	}
	if (fabsf(radius-cursorRadius)>.0001f) {
		b3DestroyShape(cursorShape,false); b3ShapeDef def=b3DefaultShapeDef(); b3Sphere sphere={{0,0,0},radius};
		cursorShape=b3CreateSphereShape(cursorBody,&def,&sphere); cursorRadius=radius;
	}
	if(!b3Body_IsEnabled(cursorBody)) {
		b3Body_SetTransform(cursorBody,(b3Pos){x,y,z},b3Quat_identity);
		b3Body_Enable(cursorBody);
	}
	b3Pos p=b3Body_GetPosition(cursorBody);
	b3Vec3 velocity={(x-p.x)/fmaxf(dt,.0001f),(y-p.y)/fmaxf(dt,.0001f),(z-p.z)/fmaxf(dt,.0001f)};
	float speed=sqrtf(velocity.x*velocity.x+velocity.y*velocity.y+velocity.z*velocity.z);
	if(speed>18){velocity.x*=18/speed;velocity.y*=18/speed;velocity.z*=18/speed;}
	b3Body_SetLinearVelocity(cursorBody,velocity);
}

__attribute__((used)) void lab_step(float dt, int substeps) {
	if (!b3World_IsValid(world)) return; b3World_Step(world,dt,substeps);
}

__attribute__((used)) uintptr_t lab_state(void) {
	for(int i=0;i<bodyCount;i++) {
		b3Pos p=b3Body_GetPosition(bodies[i].body); b3Quat q=b3Body_GetRotation(bodies[i].body); b3Vec3 v=b3Body_GetLinearVelocity(bodies[i].body);
		float* s=states+i*16; s[0]=p.x;s[1]=p.y;s[2]=p.z;s[3]=bodies[i].bound;
		s[4]=q.v.x;s[5]=q.v.y;s[6]=q.v.z;s[7]=q.s; memcpy(s+8,bodies[i].shapeData,4*sizeof(float));
		s[12]=v.x;s[13]=v.y;s[14]=v.z;s[15]=b3Body_IsAwake(bodies[i].body)?1.0f:0.0f;
	}
	return (uintptr_t)states;
}
__attribute__((used)) int lab_count(void) { return bodyCount; }
