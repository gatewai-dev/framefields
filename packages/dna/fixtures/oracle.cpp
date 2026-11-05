// Test oracle for framefields' DNA reader, built against OpenRigLogic 5.8
// (https://github.com/EpicGames/openriglogic, commit d3d329bbd6992ac38adc1c1b24203ceb998f75c0).
//   oracle write <out.dna>   writes a small synthetic character with Epic's DNA writer
//   oracle dump <in.dna>     prints what Epic's DNA reader reads, as JSON
//   oracle eval <in.dna> <seed> <n>   prints RigLogic's outputs for n seeded random control sets
//                                     (GUI and raw controls alternately, cycling the LODs), as JSON
// It regenerates oracle.dna and oracle.json, which dna-oracle.test.ts compares readDna against:
//   git clone --branch 5.8 https://github.com/EpicGames/openriglogic && cd openriglogic
//   cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build --target riglogic4
//   clang++ -std=c++17 -Iinclude <this file> build/libriglogic4*.a -o oracle
//   ./oracle write oracle.dna && ./oracle dump oracle.dna > oracle.json && ./oracle eval oracle.dna 7 48 > oracle-eval.json
#include <dna/BinaryStreamReader.h>
#include <dna/BinaryStreamWriter.h>
#include <dna/layers/Geometry.h>
#include <dna/types/Vector3.h>
#include <riglogic/RigLogic.h>
#include <pma/ScopedPtr.h>
#include <trio/streams/FileStream.h>

#include <cstdio>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

using namespace dna;

static void writeDna(const char* path) {
    auto stream = pma::makeScoped<trio::FileStream>(path, trio::FileStream::AccessMode::Write, trio::FileStream::OpenMode::Binary);
    auto w = pma::makeScoped<BinaryStreamWriter>(stream.get());

    w->setName("Oracle");
    w->setArchetype(Archetype::other);
    w->setGender(Gender::female);
    w->setAge(42);
    w->setMetaData("made by", "oracle");
    w->setMetaData("purpose", "parity");
    w->setTranslationUnit(TranslationUnit::cm);
    w->setRotationUnit(RotationUnit::degrees);
    w->setCoordinateSystem({Direction::right, Direction::up, Direction::front});
    w->setRotationSequence(RotationSequence::zyx);
    w->setRotationSign({RotationDirection::positive, RotationDirection::negative, RotationDirection::positive});
    w->setFaceWindingOrder(FaceWindingOrder::ccw);
    w->setLODCount(2);
    w->setDBMaxLOD(0);
    w->setDBComplexity("Oracle");
    w->setDBName("OracleDB");

    const char* gui[] = {"CTRL_jaw", "CTRL_smile"};
    for (std::uint16_t i = 0; i < 2; ++i) w->setGUIControlName(i, gui[i]);
    // Raw controls: three face controls, then the arm's and forearm's rotations
    // as quaternions (the host fills them from the animated skeleton).
    const char* raw[] = {"jawOpen", "smileL", "smileR", "arm.qx", "arm.qy", "arm.qz", "arm.qw",
                         "forearm.qx", "forearm.qy", "forearm.qz", "forearm.qw"};
    for (std::uint16_t i = 0; i < 11; ++i) w->setRawControlName(i, raw[i]);
    const char* joints[] = {"root", "neck", "head", "jaw", "eyeL"};
    for (std::uint16_t i = 0; i < 5; ++i) w->setJointName(i, joints[i]);
    std::uint16_t lod0Joints[] = {0, 1, 2, 3, 4};
    std::uint16_t lod1Joints[] = {0, 1, 2};
    w->setJointIndices(0, lod0Joints, 5);
    w->setJointIndices(1, lod1Joints, 3);
    w->setLODJointMapping(0, 0);
    w->setLODJointMapping(1, 1);
    const char* channels[] = {"jawOpen", "smile_corrective"};
    for (std::uint16_t i = 0; i < 2; ++i) w->setBlendShapeChannelName(i, channels[i]);
    std::uint16_t bs0[] = {0, 1};
    std::uint16_t bs1[] = {0};
    w->setBlendShapeChannelIndices(0, bs0, 2);
    w->setBlendShapeChannelIndices(1, bs1, 1);
    w->setLODBlendShapeChannelMapping(0, 0);
    w->setLODBlendShapeChannelMapping(1, 1);
    const char* maps[] = {"head_wm1_forehead", "head_wm2_cheek"};
    for (std::uint16_t i = 0; i < 2; ++i) w->setAnimatedMapName(i, maps[i]);
    std::uint16_t am0[] = {0, 1};
    w->setAnimatedMapIndices(0, am0, 2);
    w->setLODAnimatedMapMapping(0, 0);
    w->setLODAnimatedMapMapping(1, 0);
    const char* meshes[] = {"head_lod0_mesh", "head_lod1_mesh"};
    for (std::uint16_t i = 0; i < 2; ++i) w->setMeshName(i, meshes[i]);
    std::uint16_t m0[] = {0};
    std::uint16_t m1[] = {1};
    w->setMeshIndices(0, m0, 1);
    w->setMeshIndices(1, m1, 1);
    w->setLODMeshMapping(0, 0);
    w->setLODMeshMapping(1, 1);
    w->setMeshBlendShapeChannelMapping(0, 0, 0);
    w->setMeshBlendShapeChannelMapping(1, 0, 1);
    w->setMeshBlendShapeChannelMapping(2, 1, 0);
    std::uint16_t hierarchy[] = {0, 0, 1, 2, 2};
    w->setJointHierarchy(hierarchy, 5);
    Vector3 t[] = {{0.0f, 0.0f, 0.0f}, {0.0f, 150.0f, -2.0f}, {0.0f, 12.5f, 1.0f}, {0.0f, -3.0f, 4.5f}, {3.2f, 4.0f, 8.0f}};
    Vector3 r[] = {{0.0f, 0.0f, 0.0f}, {-10.0f, 0.0f, 0.0f}, {12.0f, 5.0f, -3.0f}, {0.0f, 90.0f, 25.0f}, {1.5f, -2.5f, 3.5f}};
    w->setNeutralJointTranslations(t, 5);
    w->setNeutralJointRotations(r, 5);

    // CTRL_smile drives smileL through two overlapping intervals: where both
    // match (0.4 … 0.6) only the first counts.
    std::uint16_t gIn[] = {0, 1, 1, 1};
    std::uint16_t gOut[] = {0, 1, 1, 2};
    float gFrom[] = {0.0f, 0.0f, 0.4f, 0.0f};
    float gTo[] = {1.0f, 0.6f, 1.0f, 1.0f};
    float gSlope[] = {1.0f, 1.0f, -1.0f, 0.5f};
    float gCut[] = {0.0f, 0.0f, 1.0f, 0.25f};
    w->setGUIToRawInputIndices(gIn, 4);
    w->setGUIToRawOutputIndices(gOut, 4);
    w->setGUIToRawFromValues(gFrom, 4);
    w->setGUIToRawToValues(gTo, 4);
    w->setGUIToRawSlopeValues(gSlope, 4);
    w->setGUIToRawCutValues(gCut, 4);
    w->setPSDCount(1);
    std::uint16_t psdRows[] = {11, 11};
    std::uint16_t psdCols[] = {1, 2};
    float psdValues[] = {1.5f, 1.0f};  // a weight above 1: the PSD caps at 1
    w->setPSDRowIndices(psdRows, 2);
    w->setPSDColumnIndices(psdCols, 2);
    w->setPSDValues(psdValues, 2);
    w->setJointRowCount(45);
    w->setJointColumnCount(4);
    std::uint16_t jgLods[] = {4, 2};
    std::uint16_t jgIn[] = {0, 11};
    std::uint16_t jgOut[] = {33, 34, 35, 29};
    float jgValues[] = {-0.5f, 0.0f, 12.0f, 0.0f, 0.0f, 0.1f, 0.75f, -0.25f};
    std::uint16_t jgJoints[] = {3};
    w->setJointGroupLODs(0, jgLods, 2);
    w->setJointGroupInputIndices(0, jgIn, 2);
    w->setJointGroupOutputIndices(0, jgOut, 4);
    w->setJointGroupValues(0, jgValues, 8);
    w->setJointGroupJointIndices(0, jgJoints, 1);
    // Group 1: the neck's rotation and translation from smileL, smileR and the PSD.
    std::uint16_t jg1Lods[] = {3, 1};
    std::uint16_t jg1In[] = {1, 2, 11};
    std::uint16_t jg1Out[] = {12, 13, 9};
    float jg1Values[] = {20.0f, -5.0f, 3.0f, 0.0f, 7.5f, -2.0f, 0.5f, 0.5f, 0.0f};
    std::uint16_t jg1Joints[] = {1};
    w->setJointGroupLODs(1, jg1Lods, 2);
    w->setJointGroupInputIndices(1, jg1In, 3);
    w->setJointGroupOutputIndices(1, jg1Out, 3);
    w->setJointGroupValues(1, jg1Values, 9);
    w->setJointGroupJointIndices(1, jg1Joints, 1);
    // Group 2: the eye joint's translation from the RBF pose controls (12 … 16).
    std::uint16_t jg2Lods[] = {2, 1};
    std::uint16_t jg2In[] = {12, 13, 14, 15};
    std::uint16_t jg2Out[] = {36, 37};
    float jg2Values[] = {2.0f, -1.0f, 0.5f, 3.0f, 0.0f, 1.5f, -2.5f, 0.25f};
    std::uint16_t jg2Joints[] = {4};
    w->setJointGroupLODs(2, jg2Lods, 2);
    w->setJointGroupInputIndices(2, jg2In, 4);
    w->setJointGroupOutputIndices(2, jg2Out, 2);
    w->setJointGroupValues(2, jg2Values, 8);
    w->setJointGroupJointIndices(2, jg2Joints, 1);

    // RBF: solver 0 reads the arm's quaternion (interpolative, quaternion
    // distance, Gaussian); solver 1 the forearm's twist (additive, twist angle,
    // linear, automatic radius). Their poses write controls 12 … 16.
    const float s45 = 0.38268343f, c45 = 0.92387953f;
    // The arm's fourth pose sits close to its second, so interpolation overshoots
    // and clamps; the forearm has four poses, so the automatic radius averages
    // six distances.
    const float s30 = 0.5f, c30 = 0.8660254f;
    float armTargets[] = {0, 0, 0, 1, 0, 0, s45, c45, 0, s45, 0, c45, 0, 0, s30, c30};
    float forearmTargets[] = {0, 0, 0, 1, s45, 0, 0, c45, 0.70710677f, 0, 0, 0.70710677f, c45, 0, 0, s45};
    std::uint16_t armRaw[] = {3, 4, 5, 6};
    std::uint16_t forearmRaw[] = {7, 8, 9, 10};
    std::uint16_t armPoses[] = {0, 1, 2, 6};
    std::uint16_t forearmPoses[] = {3, 4, 5, 7};
    w->setRBFSolverName(0, "arm_rbf");
    w->setRBFSolverRawControlIndices(0, armRaw, 4);
    w->setRBFSolverPoseIndices(0, armPoses, 4);
    w->setRBFSolverRawControlValues(0, armTargets, 16);
    w->setRBFSolverType(0, RBFSolverType::Interpolative);
    w->setRBFSolverRadius(0, 50.0f);
    w->setRBFSolverAutomaticRadius(0, AutomaticRadius::Off);
    w->setRBFSolverWeightThreshold(0, 0.001f);
    w->setRBFSolverDistanceMethod(0, RBFDistanceMethod::Quaternion);
    w->setRBFSolverNormalizeMethod(0, RBFNormalizeMethod::OnlyNormalizeAboveOne);
    w->setRBFSolverFunctionType(0, RBFFunctionType::Gaussian);
    w->setRBFSolverTwistAxis(0, TwistAxis::X);
    w->setRBFSolverName(1, "forearm_twist");
    w->setRBFSolverRawControlIndices(1, forearmRaw, 4);
    w->setRBFSolverPoseIndices(1, forearmPoses, 4);
    w->setRBFSolverRawControlValues(1, forearmTargets, 16);
    w->setRBFSolverType(1, RBFSolverType::Additive);
    w->setRBFSolverRadius(1, 0.0f);
    w->setRBFSolverAutomaticRadius(1, AutomaticRadius::On);
    w->setRBFSolverWeightThreshold(1, 0.0f);
    w->setRBFSolverDistanceMethod(1, RBFDistanceMethod::TwistAngle);
    w->setRBFSolverNormalizeMethod(1, RBFNormalizeMethod::AlwaysNormalize);
    w->setRBFSolverFunctionType(1, RBFFunctionType::Linear);
    w->setRBFSolverTwistAxis(1, TwistAxis::X);
    // Solver 2: the arm's swing about z (additive, swing angle, cubic).
    float swingTargets[] = {0, 0, 0, 1, s45, 0, 0, c45, 0, s45, 0, c45};
    std::uint16_t swingPoses[] = {8, 9, 10};
    w->setRBFSolverName(2, "arm_swing");
    w->setRBFSolverRawControlIndices(2, armRaw, 4);
    w->setRBFSolverPoseIndices(2, swingPoses, 3);
    w->setRBFSolverRawControlValues(2, swingTargets, 12);
    w->setRBFSolverType(2, RBFSolverType::Additive);
    w->setRBFSolverRadius(2, 60.0f);
    w->setRBFSolverAutomaticRadius(2, AutomaticRadius::Off);
    w->setRBFSolverWeightThreshold(2, 0.0f);
    w->setRBFSolverDistanceMethod(2, RBFDistanceMethod::SwingAngle);
    w->setRBFSolverNormalizeMethod(2, RBFNormalizeMethod::OnlyNormalizeAboveOne);
    w->setRBFSolverFunctionType(2, RBFFunctionType::Cubic);
    w->setRBFSolverTwistAxis(2, TwistAxis::Z);
    // Solver 3: both smiles together (interpolative, Euclidean, quintic, automatic radius).
    std::uint16_t smileRaw[] = {1, 2};
    float smileTargets[] = {0, 0, 1, 0, 0, 1, 1, 1};
    std::uint16_t smilePoses[] = {11, 12, 13, 14};
    w->setRBFSolverName(3, "smiles");
    w->setRBFSolverRawControlIndices(3, smileRaw, 2);
    w->setRBFSolverPoseIndices(3, smilePoses, 4);
    w->setRBFSolverRawControlValues(3, smileTargets, 8);
    w->setRBFSolverType(3, RBFSolverType::Interpolative);
    w->setRBFSolverRadius(3, 0.0f);
    w->setRBFSolverAutomaticRadius(3, AutomaticRadius::On);
    w->setRBFSolverWeightThreshold(3, 0.01f);
    w->setRBFSolverDistanceMethod(3, RBFDistanceMethod::Euclidean);
    w->setRBFSolverNormalizeMethod(3, RBFNormalizeMethod::OnlyNormalizeAboveOne);
    w->setRBFSolverFunctionType(3, RBFFunctionType::Quintic);
    w->setRBFSolverTwistAxis(3, TwistAxis::X);
    // Solver 4: the jaw (additive, Euclidean, exponential; radius in degrees like every RBF radius).
    std::uint16_t jawRaw[] = {0};
    float jawTargets[] = {0, 1};
    std::uint16_t jawPoses[] = {15, 16};
    w->setRBFSolverName(4, "jaw");
    w->setRBFSolverRawControlIndices(4, jawRaw, 1);
    w->setRBFSolverPoseIndices(4, jawPoses, 2);
    w->setRBFSolverRawControlValues(4, jawTargets, 2);
    w->setRBFSolverType(4, RBFSolverType::Additive);
    w->setRBFSolverRadius(4, 40.0f);
    w->setRBFSolverAutomaticRadius(4, AutomaticRadius::Off);
    w->setRBFSolverWeightThreshold(4, 0.0f);
    w->setRBFSolverDistanceMethod(4, RBFDistanceMethod::Euclidean);
    w->setRBFSolverNormalizeMethod(4, RBFNormalizeMethod::AlwaysNormalize);
    w->setRBFSolverFunctionType(4, RBFFunctionType::Exponential);
    w->setRBFSolverTwistAxis(4, TwistAxis::X);
    std::uint16_t rbfLod0[] = {0, 1, 2, 3, 4};
    std::uint16_t rbfLod1[] = {0, 2};
    w->setRBFSolverIndices(0, rbfLod0, 5);
    w->setRBFSolverIndices(1, rbfLod1, 2);
    w->setLODRBFSolverMapping(0, 0);
    w->setLODRBFSolverMapping(1, 1);
    const char* poses[] = {"arm_rest", "arm_up", "arm_forward", "forearm_rest", "forearm_twist45", "forearm_twist90",
                           "arm_up30", "forearm_twist135", "swing_rest", "swing_x", "swing_y", "smiles_none", "smiles_left",
                           "smiles_right", "smiles_both", "jaw_closed", "jaw_open"};
    float poseScales[] = {1.0f, 1.0f, 0.8f, 1.0f, 1.0f, 1.2f, 0.9f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.1f, 1.0f, 1.0f};
    for (std::uint16_t i = 0; i < 17; ++i) {
        w->setRBFPoseName(i, poses[i]);
        w->setRBFPoseScale(i, poseScales[i]);
    }
    const char* poseControls[] = {"arm_up_pc", "arm_forward_pc", "forearm_twist45_pc", "forearm_twist90_pc", "arm_up_half_pc"};
    for (std::uint16_t i = 0; i < 5; ++i) w->setRBFPoseControlName(i, poseControls[i]);
    std::uint16_t none[] = {0};
    std::uint16_t up[] = {12, 16};
    float upWeights[] = {1.0f, 0.5f};
    std::uint16_t forward[] = {13};
    float one[] = {1.0f};
    std::uint16_t gate[] = {0};  // arm_forward only counts as far as jawOpen allows
    std::uint16_t twist45[] = {14};
    std::uint16_t twist90[] = {15};
    for (std::uint16_t i : {0, 3}) {
        w->setRBFPoseInputControlIndices(i, none, 0);
        w->setRBFPoseOutputControlIndices(i, none, 0);
        w->setRBFPoseOutputControlWeights(i, one, 0);
    }
    w->setRBFPoseInputControlIndices(1, none, 0);
    w->setRBFPoseOutputControlIndices(1, up, 2);
    w->setRBFPoseOutputControlWeights(1, upWeights, 2);
    w->setRBFPoseInputControlIndices(2, gate, 1);
    w->setRBFPoseOutputControlIndices(2, forward, 1);
    w->setRBFPoseOutputControlWeights(2, one, 1);
    w->setRBFPoseInputControlIndices(4, none, 0);
    w->setRBFPoseOutputControlIndices(4, twist45, 1);
    w->setRBFPoseOutputControlWeights(4, one, 1);
    w->setRBFPoseInputControlIndices(5, none, 0);
    w->setRBFPoseOutputControlIndices(5, twist90, 1);
    w->setRBFPoseOutputControlWeights(5, one, 1);
    std::uint16_t up30[] = {12};
    float up30Weight[] = {0.7f};
    w->setRBFPoseInputControlIndices(6, none, 0);
    w->setRBFPoseOutputControlIndices(6, up30, 1);
    w->setRBFPoseOutputControlWeights(6, up30Weight, 1);
    w->setRBFPoseInputControlIndices(7, none, 0);
    w->setRBFPoseOutputControlIndices(7, twist90, 1);
    w->setRBFPoseOutputControlWeights(7, one, 1);
    // New poses: each writes one control with its own weight, or nothing.
    struct PoseOut {
        std::uint16_t pose;
        std::uint16_t control;
        float weight;
    };
    const PoseOut outs[] = {{9, 16, 0.3f}, {10, 14, 0.4f}, {14, 13, 0.5f}, {12, 16, 0.6f}, {16, 15, 0.2f}};
    for (std::uint16_t pose : {8, 11, 13, 15}) {
        w->setRBFPoseInputControlIndices(pose, none, 0);
        w->setRBFPoseOutputControlIndices(pose, none, 0);
        w->setRBFPoseOutputControlWeights(pose, one, 0);
    }
    for (const auto& o : outs) {
        w->setRBFPoseInputControlIndices(o.pose, none, 0);
        w->setRBFPoseOutputControlIndices(o.pose, &o.control, 1);
        w->setRBFPoseOutputControlWeights(o.pose, &o.weight, 1);
    }

    // Twist and swing: the forearm's twist spreads to the jaw and eye joints
    // (half and a quarter); the arm's swing turns the head by 0.3.
    std::uint16_t twistOut[] = {3, 4};
    float twistWeights[] = {0.5f, 0.25f};
    w->setTwistSetupTwistAxis(0, TwistAxis::X);
    w->setTwistInputControlIndices(0, forearmRaw, 4);
    w->setTwistOutputJointIndices(0, twistOut, 2);
    w->setTwistBlendWeights(0, twistWeights, 2);
    std::uint16_t swingOut[] = {2};
    float swingWeights[] = {0.3f};
    w->setSwingSetupTwistAxis(0, TwistAxis::Y);
    w->setSwingInputControlIndices(0, armRaw, 4);
    w->setSwingOutputJointIndices(0, swingOut, 1);
    w->setSwingBlendWeights(0, swingWeights, 1);
    std::uint16_t bsLods[] = {2, 1};
    std::uint16_t bsIn[] = {0, 11};
    std::uint16_t bsOut[] = {0, 1};
    w->setBlendShapeChannelLODs(bsLods, 2);
    w->setBlendShapeChannelInputIndices(bsIn, 2);
    w->setBlendShapeChannelOutputIndices(bsOut, 2);
    // The cheek map rises then falls back over two overlapping intervals; LOD 1 keeps the first two rows.
    std::uint16_t amLods[] = {3, 2};
    std::uint16_t amIn[] = {0, 1, 1};
    std::uint16_t amOut[] = {0, 1, 1};
    float amFrom[] = {0.0f, 0.0f, 0.5f};
    float amTo[] = {1.0f, 0.7f, 1.0f};
    float amSlope[] = {1.0f, 0.8f, -0.5f};
    float amCut[] = {0.0f, 0.1f, 0.9f};
    w->setAnimatedMapLODs(amLods, 2);
    w->setAnimatedMapInputIndices(amIn, 3);
    w->setAnimatedMapOutputIndices(amOut, 3);
    w->setAnimatedMapFromValues(amFrom, 3);
    w->setAnimatedMapToValues(amTo, 3);
    w->setAnimatedMapSlopeValues(amSlope, 3);
    w->setAnimatedMapCutValues(amCut, 3);

    // Mesh 0: a quad and a triangle; mesh 1: one triangle.
    Position p0[] = {{-5.0f, 150.0f, 9.0f}, {5.0f, 150.0f, 9.0f}, {5.0f, 165.0f, 8.0f}, {-5.0f, 165.0f, 8.0f}, {0.0f, 170.0f, 7.5f}};
    TextureCoordinate uv0[] = {{0.1f, 0.2f}, {0.9f, 0.2f}, {0.9f, 0.8f}, {0.1f, 0.8f}, {0.5f, 0.95f}, {0.55f, 0.95f}};
    Normal n0[] = {{0.0f, 0.0f, 1.0f}, {0.0f, 0.6f, 0.8f}};
    VertexLayout l0[] = {{0, 0, 0}, {1, 1, 0}, {2, 2, 0}, {3, 3, 0}, {4, 4, 1}, {4, 5, 1}};
    w->setVertexPositions(0, p0, 5);
    w->setVertexTextureCoordinates(0, uv0, 6);
    w->setVertexNormals(0, n0, 2);
    w->setVertexLayouts(0, l0, 6);
    std::uint32_t f0[] = {0, 1, 2, 3};
    std::uint32_t f1[] = {3, 2, 4};
    w->setFaceVertexLayoutIndices(0, 0, f0, 4);
    w->setFaceVertexLayoutIndices(0, 1, f1, 3);
    w->setMaximumInfluencePerVertex(0, 6);
    float sw0[] = {1.0f};
    std::uint16_t sj0[] = {1};
    float sw1[] = {0.5f, 0.5f};
    std::uint16_t sj1[] = {1, 2};
    float sw2[] = {0.3f, 0.2f, 0.15f, 0.15f, 0.1f, 0.1f};
    std::uint16_t sj2[] = {2, 3, 4, 1, 0, 3};
    w->setSkinWeightsValues(0, 0, sw0, 1);
    w->setSkinWeightsJointIndices(0, 0, sj0, 1);
    w->setSkinWeightsValues(0, 1, sw1, 2);
    w->setSkinWeightsJointIndices(0, 1, sj1, 2);
    w->setSkinWeightsValues(0, 2, sw2, 6);
    w->setSkinWeightsJointIndices(0, 2, sj2, 6);
    w->setSkinWeightsValues(0, 3, sw0, 1);
    w->setSkinWeightsJointIndices(0, 3, sj0, 1);
    w->setSkinWeightsValues(0, 4, sw1, 2);
    w->setSkinWeightsJointIndices(0, 4, sj1, 2);
    Delta d0[] = {{0.0f, -1.5f, 0.2f}, {0.0f, -1.5f, 0.2f}};
    std::uint32_t v0[] = {0, 1};
    Delta d1[] = {{0.3f, 0.4f, -0.1f}};
    std::uint32_t v1[] = {2};
    w->setBlendShapeChannelIndex(0, 0, 0);
    w->setBlendShapeTargetDeltas(0, 0, d0, 2);
    w->setBlendShapeTargetVertexIndices(0, 0, v0, 2);
    w->setBlendShapeChannelIndex(0, 1, 1);
    w->setBlendShapeTargetDeltas(0, 1, d1, 1);
    w->setBlendShapeTargetVertexIndices(0, 1, v1, 1);

    Position p1[] = {{-5.0f, 150.0f, 9.0f}, {5.0f, 150.0f, 9.0f}, {0.0f, 170.0f, 7.5f}};
    TextureCoordinate uv1[] = {{0.0f, 0.0f}, {1.0f, 0.0f}, {0.5f, 1.0f}};
    Normal n1[] = {{0.0f, 0.0f, 1.0f}};
    VertexLayout l1[] = {{0, 0, 0}, {1, 1, 0}, {2, 2, 0}};
    w->setVertexPositions(1, p1, 3);
    w->setVertexTextureCoordinates(1, uv1, 3);
    w->setVertexNormals(1, n1, 1);
    w->setVertexLayouts(1, l1, 3);
    std::uint32_t f2[] = {0, 1, 2};
    w->setFaceVertexLayoutIndices(1, 0, f2, 3);
    w->setMaximumInfluencePerVertex(1, 1);
    for (std::uint32_t v = 0; v < 3; ++v) {
        w->setSkinWeightsValues(1, v, sw0, 1);
        w->setSkinWeightsJointIndices(1, v, sj0, 1);
    }
    Delta d2[] = {{0.0f, -1.0f, 0.0f}};
    std::uint32_t v2[] = {0};
    w->setBlendShapeChannelIndex(1, 0, 0);
    w->setBlendShapeTargetDeltas(1, 0, d2, 1);
    w->setBlendShapeTargetVertexIndices(1, 0, v2, 1);

    w->write();
    if (!Status::isOk()) {
        std::fprintf(stderr, "write failed: %s\n", Status::get().message);
        std::exit(1);
    }
}

static void printString(StringView s) {
    std::putchar('"');
    for (std::size_t i = 0; i < s.size(); ++i) {
        const char c = s[i];
        if (c == '"' || c == '\\') std::putchar('\\');
        std::putchar(c);
    }
    std::putchar('"');
}

template<typename V>
static void printArray(const V& a) {
    std::putchar('[');
    for (std::size_t i = 0; i < a.size(); ++i) {
        if (i) std::putchar(',');
        std::printf("%.9g", static_cast<double>(a[i]));
    }
    std::putchar(']');
}

static void dumpDna(const char* path) {
    auto stream = pma::makeScoped<trio::FileStream>(path, trio::FileStream::AccessMode::Read, trio::FileStream::OpenMode::Binary);
    auto r = pma::makeScoped<BinaryStreamReader>(stream.get(), DataLayer::All);
    r->read();
    if (!Status::isOk()) {
        std::fprintf(stderr, "read failed: %s\n", Status::get().message);
        std::exit(1);
    }
    std::printf("{\"version\":[%u,%u]", r->getFileFormatGeneration(), r->getFileFormatVersion());
    std::printf(",\"name\":");
    printString(r->getName());
    std::printf(",\"archetype\":%d,\"gender\":%d,\"age\":%u", static_cast<int>(r->getArchetype()), static_cast<int>(r->getGender()), r->getAge());
    std::printf(",\"metadata\":[");
    for (std::uint32_t i = 0; i < r->getMetaDataCount(); ++i) {
        if (i) std::putchar(',');
        const auto key = r->getMetaDataKey(i);
        std::putchar('[');
        printString(key);
        std::putchar(',');
        printString(r->getMetaDataValue(std::string(key.data(), key.size()).c_str()));
        std::putchar(']');
    }
    std::printf("]");
    const auto cs = r->getCoordinateSystem();
    const auto sign = r->getRotationSign();
    std::printf(",\"translationUnit\":%d,\"rotationUnit\":%d,\"coordinateSystem\":[%d,%d,%d]", static_cast<int>(r->getTranslationUnit()),
                static_cast<int>(r->getRotationUnit()), static_cast<int>(cs.x), static_cast<int>(cs.y), static_cast<int>(cs.z));
    std::printf(",\"rotationSequence\":%d,\"rotationSign\":[%d,%d,%d],\"faceWindingOrder\":%d", static_cast<int>(r->getRotationSequence()),
                static_cast<int>(sign.x), static_cast<int>(sign.y), static_cast<int>(sign.z), static_cast<int>(r->getFaceWindingOrder()));
    std::printf(",\"lodCount\":%u,\"maxLOD\":%u,\"complexity\":", r->getLODCount(), r->getDBMaxLOD());
    printString(r->getDBComplexity());
    std::printf(",\"dbName\":");
    printString(r->getDBName());

    auto names = [&](const char* key, std::uint16_t count, auto get) {
        std::printf(",\"%s\":[", key);
        for (std::uint16_t i = 0; i < count; ++i) {
            if (i) std::putchar(',');
            printString(get(i));
        }
        std::printf("]");
    };
    names("guiControlNames", r->getGUIControlCount(), [&](std::uint16_t i) { return r->getGUIControlName(i); });
    names("rawControlNames", r->getRawControlCount(), [&](std::uint16_t i) { return r->getRawControlName(i); });
    names("jointNames", r->getJointCount(), [&](std::uint16_t i) { return r->getJointName(i); });
    names("blendShapeChannelNames", r->getBlendShapeChannelCount(), [&](std::uint16_t i) { return r->getBlendShapeChannelName(i); });
    names("animatedMapNames", r->getAnimatedMapCount(), [&](std::uint16_t i) { return r->getAnimatedMapName(i); });
    names("meshNames", r->getMeshCount(), [&](std::uint16_t i) { return r->getMeshName(i); });
    auto perLod = [&](const char* key, auto get) {
        std::printf(",\"%s\":[", key);
        for (std::uint16_t lod = 0; lod < r->getLODCount(); ++lod) {
            if (lod) std::putchar(',');
            printArray(get(lod));
        }
        std::printf("]");
    };
    perLod("jointsPerLod", [&](std::uint16_t l) { return r->getJointIndicesForLOD(l); });
    perLod("blendShapesPerLod", [&](std::uint16_t l) { return r->getBlendShapeChannelIndicesForLOD(l); });
    perLod("animatedMapsPerLod", [&](std::uint16_t l) { return r->getAnimatedMapIndicesForLOD(l); });
    perLod("meshesPerLod", [&](std::uint16_t l) { return r->getMeshIndicesForLOD(l); });
    std::printf(",\"meshBlendShapeChannelMapping\":[");
    for (std::uint16_t i = 0; i < r->getMeshBlendShapeChannelMappingCount(); ++i) {
        const auto m = r->getMeshBlendShapeChannelMapping(i);
        std::printf("%s[%u,%u]", i ? "," : "", m.meshIndex, m.blendShapeChannelIndex);
    }
    std::printf("],\"parents\":[");
    for (std::uint16_t i = 0; i < r->getJointCount(); ++i) std::printf("%s%u", i ? "," : "", r->getJointParentIndex(i));
    std::printf("]");
    std::printf(",\"neutralTranslations\":[");
    printArray(r->getNeutralJointTranslationXs());
    std::putchar(',');
    printArray(r->getNeutralJointTranslationYs());
    std::putchar(',');
    printArray(r->getNeutralJointTranslationZs());
    std::printf("],\"neutralRotations\":[");
    printArray(r->getNeutralJointRotationXs());
    std::putchar(',');
    printArray(r->getNeutralJointRotationYs());
    std::putchar(',');
    printArray(r->getNeutralJointRotationZs());
    std::printf("]");

    auto arr = [&](const char* key, auto view) {
        std::printf(",\"%s\":", key);
        printArray(view);
    };
    arr("guiToRawInput", r->getGUIToRawInputIndices());
    arr("guiToRawOutput", r->getGUIToRawOutputIndices());
    arr("guiToRawFrom", r->getGUIToRawFromValues());
    arr("guiToRawTo", r->getGUIToRawToValues());
    arr("guiToRawSlope", r->getGUIToRawSlopeValues());
    arr("guiToRawCut", r->getGUIToRawCutValues());
    std::printf(",\"psdCount\":%u", r->getPSDCount());
    arr("psdRows", r->getPSDRowIndices());
    arr("psdColumns", r->getPSDColumnIndices());
    arr("psdValues", r->getPSDValues());
    std::printf(",\"jointRowCount\":%u,\"jointColumnCount\":%u,\"jointGroups\":[", r->getJointRowCount(), r->getJointColumnCount());
    for (std::uint16_t g = 0; g < r->getJointGroupCount(); ++g) {
        std::printf("%s{\"lods\":", g ? "," : "");
        printArray(r->getJointGroupLODs(g));
        std::printf(",\"inputs\":");
        printArray(r->getJointGroupInputIndices(g));
        std::printf(",\"outputs\":");
        printArray(r->getJointGroupOutputIndices(g));
        std::printf(",\"values\":");
        printArray(r->getJointGroupValues(g));
        std::printf(",\"joints\":");
        printArray(r->getJointGroupJointIndices(g));
        std::printf("}");
    }
    std::printf("]");
    arr("blendShapeLods", r->getBlendShapeChannelLODs());
    arr("blendShapeInputs", r->getBlendShapeChannelInputIndices());
    arr("blendShapeOutputs", r->getBlendShapeChannelOutputIndices());
    arr("animatedMapLods", r->getAnimatedMapLODs());
    arr("animatedMapInputs", r->getAnimatedMapInputIndices());
    arr("animatedMapOutputs", r->getAnimatedMapOutputIndices());
    arr("animatedMapFrom", r->getAnimatedMapFromValues());
    arr("animatedMapTo", r->getAnimatedMapToValues());
    arr("animatedMapSlope", r->getAnimatedMapSlopeValues());
    arr("animatedMapCut", r->getAnimatedMapCutValues());

    std::printf(",\"mlControlCount\":%u,\"rbfSolversPerLod\":[", r->getMLControlCount());
    for (std::uint16_t lod = 0; lod < r->getLODCount(); ++lod) {
        if (lod) std::putchar(',');
        printArray(r->getRBFSolverIndicesForLOD(lod));
    }
    std::printf("],\"rbfSolvers\":[");
    for (std::uint16_t i = 0; i < r->getRBFSolverCount(); ++i) {
        std::printf("%s{\"name\":", i ? "," : "");
        printString(r->getRBFSolverName(i));
        std::printf(",\"rawControlIndices\":");
        printArray(r->getRBFSolverRawControlIndices(i));
        std::printf(",\"poseIndices\":");
        printArray(r->getRBFSolverPoseIndices(i));
        std::printf(",\"rawControlValues\":");
        printArray(r->getRBFSolverRawControlValues(i));
        std::printf(",\"radius\":%.9g,\"weightThreshold\":%.9g,\"solverType\":%d,\"automaticRadius\":%d,\"distanceMethod\":%d,"
                    "\"normalizeMethod\":%d,\"functionType\":%d,\"twistAxis\":%d}",
                    static_cast<double>(r->getRBFSolverRadius(i)), static_cast<double>(r->getRBFSolverWeightThreshold(i)),
                    static_cast<int>(r->getRBFSolverType(i)), static_cast<int>(r->getRBFSolverAutomaticRadius(i)),
                    static_cast<int>(r->getRBFSolverDistanceMethod(i)), static_cast<int>(r->getRBFSolverNormalizeMethod(i)),
                    static_cast<int>(r->getRBFSolverFunctionType(i)), static_cast<int>(r->getRBFSolverTwistAxis(i)));
    }
    std::printf("],\"rbfPoses\":[");
    for (std::uint16_t i = 0; i < r->getRBFPoseCount(); ++i) {
        std::printf("%s{\"name\":", i ? "," : "");
        printString(r->getRBFPoseName(i));
        std::printf(",\"scale\":%.9g,\"inputs\":", static_cast<double>(r->getRBFPoseScale(i)));
        printArray(r->getRBFPoseInputControlIndices(i));
        std::printf(",\"outputs\":");
        printArray(r->getRBFPoseOutputControlIndices(i));
        std::printf(",\"weights\":");
        printArray(r->getRBFPoseOutputControlWeights(i));
        std::printf("}");
    }
    std::printf("]");
    names("rbfPoseControlNames", r->getRBFPoseControlCount(), [&](std::uint16_t i) { return r->getRBFPoseControlName(i); });
    auto setups = [&](const char* key, std::uint16_t count, auto axis, auto inputs, auto outputs, auto weights) {
        std::printf(",\"%s\":[", key);
        for (std::uint16_t i = 0; i < count; ++i) {
            std::printf("%s{\"twistAxis\":%d,\"inputs\":", i ? "," : "", static_cast<int>(axis(i)));
            printArray(inputs(i));
            std::printf(",\"outputs\":");
            printArray(outputs(i));
            std::printf(",\"weights\":");
            printArray(weights(i));
            std::printf("}");
        }
        std::printf("]");
    };
    setups(
        "twists", r->getTwistCount(), [&](std::uint16_t i) { return r->getTwistSetupTwistAxis(i); },
        [&](std::uint16_t i) { return r->getTwistInputControlIndices(i); }, [&](std::uint16_t i) { return r->getTwistOutputJointIndices(i); },
        [&](std::uint16_t i) { return r->getTwistBlendWeights(i); });
    setups(
        "swings", r->getSwingCount(), [&](std::uint16_t i) { return r->getSwingSetupTwistAxis(i); },
        [&](std::uint16_t i) { return r->getSwingInputControlIndices(i); }, [&](std::uint16_t i) { return r->getSwingOutputJointIndices(i); },
        [&](std::uint16_t i) { return r->getSwingBlendWeights(i); });
    std::printf(",\"rotationRepresentations\":[");
    for (std::uint16_t i = 0; i < r->getJointCount(); ++i)
        std::printf("%s%d", i ? "," : "", static_cast<int>(r->getJointRotationRepresentation(i)));
    std::printf("]");

    std::printf(",\"meshes\":[");
    for (std::uint16_t m = 0; m < r->getMeshCount(); ++m) {
        std::printf("%s{\"positions\":[", m ? "," : "");
        printArray(r->getVertexPositionXs(m));
        std::putchar(',');
        printArray(r->getVertexPositionYs(m));
        std::putchar(',');
        printArray(r->getVertexPositionZs(m));
        std::printf("],\"uvs\":[");
        printArray(r->getVertexTextureCoordinateUs(m));
        std::putchar(',');
        printArray(r->getVertexTextureCoordinateVs(m));
        std::printf("],\"normals\":[");
        printArray(r->getVertexNormalXs(m));
        std::putchar(',');
        printArray(r->getVertexNormalYs(m));
        std::putchar(',');
        printArray(r->getVertexNormalZs(m));
        std::printf("],\"layouts\":[");
        printArray(r->getVertexLayoutPositionIndices(m));
        std::putchar(',');
        printArray(r->getVertexLayoutTextureCoordinateIndices(m));
        std::putchar(',');
        printArray(r->getVertexLayoutNormalIndices(m));
        std::printf("],\"faces\":[");
        for (std::uint32_t f = 0; f < r->getFaceCount(m); ++f) {
            if (f) std::putchar(',');
            printArray(r->getFaceVertexLayoutIndices(m, f));
        }
        std::printf("],\"maxInfluence\":%u,\"skin\":[", r->getMaximumInfluencePerVertex(m));
        for (std::uint32_t v = 0; v < r->getSkinWeightsCount(m); ++v) {
            std::printf("%s[", v ? "," : "");
            printArray(r->getSkinWeightsValues(m, v));
            std::putchar(',');
            printArray(r->getSkinWeightsJointIndices(m, v));
            std::printf("]");
        }
        std::printf("],\"targets\":[");
        for (std::uint16_t t = 0; t < r->getBlendShapeTargetCount(m); ++t) {
            std::printf("%s{\"channel\":%u,\"deltas\":[", t ? "," : "", r->getBlendShapeChannelIndex(m, t));
            printArray(r->getBlendShapeTargetDeltaXs(m, t));
            std::putchar(',');
            printArray(r->getBlendShapeTargetDeltaYs(m, t));
            std::putchar(',');
            printArray(r->getBlendShapeTargetDeltaZs(m, t));
            std::printf("],\"vertices\":");
            printArray(r->getBlendShapeTargetVertexIndices(m, t));
            std::printf("}");
        }
        std::printf("]}");
    }
    std::printf("]}\n");
}

// Seeded random controls in 0 … 1.2 (past the top, to exercise clamping).
static float nextRandom(std::uint32_t& state) {
    state = state * 1664525u + 1013904223u;
    return static_cast<float>(state >> 8) / static_cast<float>(1u << 24) * 1.2f;
}

static void evalDna(const char* path, std::uint32_t seed, int count) {
    auto stream = pma::makeScoped<trio::FileStream>(path, trio::FileStream::AccessMode::Read, trio::FileStream::OpenMode::Binary);
    auto reader = pma::makeScoped<BinaryStreamReader>(stream.get(), DataLayer::All);
    reader->read();
    if (!Status::isOk()) {
        std::fprintf(stderr, "read failed: %s\n", Status::get().message);
        std::exit(1);
    }
    rl4::Configuration config;
    config.calculationType = rl4::CalculationType::Scalar;
    config.floatingPointType = rl4::FloatingPointType::Float;
    auto rig = pma::makeScoped<rl4::RigLogic>(reader.get(), config);
    auto instance = pma::makeScoped<rl4::RigInstance>(rig.get());
    std::uint32_t state = seed;
    std::printf("[");
    for (int n = 0; n < count; ++n) {
        const bool gui = (n % 2) == 0;
        const std::uint16_t lod = static_cast<std::uint16_t>(n % reader->getLODCount());
        instance->setLOD(lod);
        std::vector<float> controls;
        const std::uint16_t controlCount = gui ? instance->getGUIControlCount() : instance->getRawControlCount();
        for (std::uint16_t i = 0; i < controlCount; ++i) controls.push_back(nextRandom(state));
        // Joint rotations come in as unit quaternions, set after any GUI
        // mapping (which writes every raw control), as a host does.
        std::vector<float> quats;
        const bool body = instance->getRawControlCount() >= 11;
        if (body) {
            for (int q = 0; q < 2; ++q) {
                float v[4];
                float len = 0.0f;
                for (float& c : v) {
                    c = nextRandom(state) - 0.6f;
                    len += c * c;
                }
                len = std::sqrt(len);
                for (float c : v) quats.push_back(c / len);
            }
        }
        if (gui) {
            for (std::uint16_t i = 0; i < controlCount; ++i) instance->setGUIControl(i, controls[i]);
            rig->mapGUIToRawControls(instance.get());
        } else {
            for (std::uint16_t i = 0; i < controlCount; ++i) instance->setRawControl(i, controls[i]);
        }
        for (std::size_t k = 0; k < quats.size(); ++k) instance->setRawControl(static_cast<std::uint16_t>(3 + k), quats[k]);
        rig->calculate(instance.get());
        std::printf("%s{\"lod\":%u,\"%s\":", n ? "," : "", lod, gui ? "gui" : "raw");
        printArray(controls);
        std::printf(",\"quats\":");
        printArray(quats);
        std::printf(",\"rawControls\":");
        printArray(instance->getRawControlValues());
        std::printf(",\"psdControls\":");
        printArray(instance->getPSDControlValues());
        std::printf(",\"rbfControls\":");
        printArray(instance->getRBFControlValues());
        std::printf(",\"joints\":");
        printArray(instance->getJointOutputs());
        std::printf(",\"blendShapes\":");
        printArray(instance->getBlendShapeOutputs());
        std::printf(",\"animatedMaps\":");
        printArray(instance->getAnimatedMapOutputs());
        std::printf("}");
    }
    std::printf("]\n");
}

int main(int argc, char** argv) {
    if (argc == 3 && std::strcmp(argv[1], "write") == 0) writeDna(argv[2]);
    else if (argc == 3 && std::strcmp(argv[1], "dump") == 0) dumpDna(argv[2]);
    else if (argc == 5 && std::strcmp(argv[1], "eval") == 0)
        evalDna(argv[2], static_cast<std::uint32_t>(std::strtoul(argv[3], nullptr, 10)), std::atoi(argv[4]));
    else {
        std::fprintf(stderr, "usage: oracle write <out.dna> | oracle dump <in.dna>\n");
        return 2;
    }
    return 0;
}
