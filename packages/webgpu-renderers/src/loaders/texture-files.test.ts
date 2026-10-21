import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FbxLoader, loadFBX } from "./fbx-loader.js";
import { loadOBJ, ObjLoader } from "./obj-loader.js";
import { isSupportedTexture, readTextureFile } from "./texture-files.js";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

const QUAD_OBJ = `mtllib quad.mtl
v -1 -1 0
v 1 -1 0
v 1 1 0
v -1 1 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
usemtl Wood
f 1/1 2/2 3/3 4/4
`;

const fbxWithTexture = (fileName: string, content = "") => `
; FBX 7.4.0 project file
Objects:  {
	Geometry: 1001, "Geometry::Quad", "Mesh" {
		Vertices: *12 {
			a: -10,-10,0, 10,-10,0, 10,10,0, -10,10,0
		}
		PolygonVertexIndex: *4 {
			a: 0,1,2,-4
		}
	}
	Model: 3001, "Model::QuadModel", "Mesh" {
	}
	Material: 2001, "Material::Painted", "" {
		Properties70:  {
			P: "DiffuseColor", "Color", "", "A",1,1,1
		}
	}
	Texture: 4001, "Texture::PaintedDiffuse", "" {
		FileName: "C:\\\\Users\\\\artist\\\\textures\\\\${fileName}"
		RelativeFilename: "textures\\\\${fileName}"
	}${content}
}

Connections:  {
	C: "OO", 1001, 3001
	C: "OO", 2001, 3001
	C: "OP", 4001, 2001, "DiffuseColor"
}
`;

describe("model textures", () => {
	let dir: string;
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "framefields-textures-"));
	});
	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("finds a texture by its file name when the written path is absolute elsewhere", () => {
		fs.mkdirSync(path.join(dir, "textures"));
		fs.writeFileSync(path.join(dir, "textures", "wood.png"), PNG_BYTES);
		const file = readTextureFile("C:\\Users\\artist\\maps\\wood.png", dir);
		expect(file?.bytes).toEqual(PNG_BYTES);
		expect(file?.mime).toBe("image/png");
	});

	it("loads OBJ map_Kd and norm textures relative to the .mtl file, past map options", () => {
		fs.mkdirSync(path.join(dir, "maps"));
		fs.writeFileSync(path.join(dir, "maps", "wood grain.png"), PNG_BYTES);
		fs.writeFileSync(path.join(dir, "maps", "wood_n.png"), PNG_BYTES);
		fs.writeFileSync(
			path.join(dir, "quad.mtl"),
			`newmtl Wood
Kd 1 1 1
map_Kd -s 2 2 1 -bm 1.0 maps/wood grain.png
norm maps/wood_n.png
map_Bump maps/height.png
`,
		);
		fs.writeFileSync(path.join(dir, "quad.obj"), QUAD_OBJ);

		const model = loadOBJ(path.join(dir, "quad.obj"));
		const wood = model.materials.Wood!;
		expect(wood.diffuseTexture).toBe("maps/wood grain.png");
		expect(wood.diffuseTextureBuffer).toEqual(PNG_BYTES);
		expect(wood.textureWrap).toBe("repeat");
		expect(wood.normalTextureBuffer).toEqual(PNG_BYTES);
		expect(model.meshes[0]?.materialName).toBe("Wood");
	});

	it("parses -clamp on as clamped addressing", () => {
		const mats = ObjLoader.parseMtl("newmtl A\nmap_Kd -clamp on a.png\n");
		expect(mats.A?.diffuseTexture).toBe("a.png");
		expect(mats.A?.textureWrap).toBe("clamp");
	});

	it("warns when an OBJ texture is missing", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		fs.writeFileSync(
			path.join(dir, "quad.mtl"),
			"newmtl Wood\nmap_Kd gone.png\n",
		);
		fs.writeFileSync(path.join(dir, "quad.obj"), QUAD_OBJ);
		const model = loadOBJ(path.join(dir, "quad.obj"));
		expect(model.materials.Wood?.diffuseTextureBuffer).toBeUndefined();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("gone.png"));
	});

	it("assigns FBX meshes their model's material and loads its diffuse texture", () => {
		fs.mkdirSync(path.join(dir, "textures"));
		fs.writeFileSync(path.join(dir, "textures", "paint.png"), PNG_BYTES);
		fs.writeFileSync(path.join(dir, "quad.fbx"), fbxWithTexture("paint.png"));

		const model = loadFBX(path.join(dir, "quad.fbx"));
		expect(model.meshes[0]?.materialName).toBe("Painted");
		const mat = model.materials.Painted!;
		expect(mat.diffuseTextureBuffer).toEqual(PNG_BYTES);
		expect(mat.textureWrap).toBe("repeat");
	});

	it("prefers FBX textures embedded in a Video's Content", () => {
		const embedded = new Uint8Array([9, 8, 7]);
		const root = FbxLoader.parseAscii(fbxWithTexture("missing.png"));
		const objects = root.children.find((c) => c.name === "Objects")!;
		objects.children.push({
			name: "Video",
			props: [5001, "Video::PaintedDiffuse", "Clip"],
			children: [{ name: "Content", props: [embedded], children: [] }],
		});
		root.children
			.find((c) => c.name === "Connections")!
			.children.push({ name: "C", props: ["OO", 5001, 4001], children: [] });

		const model = FbxLoader.buildModelFromTree(root, { basePath: dir });
		expect(model.materials.Painted?.diffuseTextureBuffer).toEqual(embedded);
	});
});

describe("texture formats", () => {
	it("skips formats the renderer cannot decode, even when the file exists", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "framefields-tga-"));
		fs.writeFileSync(path.join(dir, "paint.tga"), PNG_BYTES);
		expect(isSupportedTexture("paint.tga")).toBe(false);
		expect(isSupportedTexture("C:\\maps\\paint.PNG")).toBe(true);
		expect(readTextureFile("paint.tga", dir)).toBeUndefined();
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
