using UnityEngine;

namespace RTG
{
    public class GizmoDblAxisScaleDrag3D : GizmoPlaneDrag3D
    {
        public struct WorkData
        {
            public int AxisIndex0;
            public int AxisIndex1;
            public Vector3 DragOrigin;
            public Vector3 Axis0;
            public Vector3 Axis1;
            public float IndSnapStep0;
            public float IndSnapStep1;
            public float IndBaseSize0;
            public float IndBaseSize1;
            public float PropSnapStep;
            public float PropBaseSize;
            public Vector3 PropAxis;
            public GizmoDblAxisScaleMode ScaleMode;
        }

        private WorkData _workData;
        private float _accumSnapDrag0;
        private float _accumSnapDrag1;
        private float _scaledSize0;
        private float _scaledSize1;
        private float _relativeScale0 = 1.0f;
        private float _relativeScale1 = 1.0f;
        private float _totalScale0 = 1.0f;
        private float _totalScale1 = 1.0f;

        public override GizmoDragChannel DragChannel { get { return GizmoDragChannel.Scale; } }
        public int AxisIndex0 { get { return _workData.AxisIndex0; } }
        public int AxisIndex1 { get { return _workData.AxisIndex1; } }
        public float RelativeScale0 { get { return _relativeScale0; } }
        public float RelativeScale1 { get { return _relativeScale1; } }
        public float TotalScale0 { get { return _totalScale0; } }
        public float TotalScale1 { get { return _totalScale1; } }

        public void SetWorkData(WorkData workData)
        {
            if (!IsActive)
            {
                _workData = workData;

                if (_workData.ScaleMode == GizmoDblAxisScaleMode.Independent)
                {
                    _scaledSize0 = _workData.IndBaseSize0;
                    _scaledSize1 = _workData.IndBaseSize1;
                }
                else
                {
                    _scaledSize0 = _workData.PropBaseSize;
                    _scaledSize1 = _workData.PropBaseSize;
                }
            }
        }

        protected override Plane CalculateDragPlane()
        {
            Vector3 planeNormal = Vector3.Cross(_workData.Axis0, _workData.Axis1).normalized;
            return new Plane(planeNormal, _workData.DragOrigin);
        }

        protected override void CalculateDragValues()
        {
            float dragAlongAxis0, dragAlongAxis1;
            float snapStep0, snapStep1;
            float baseSize0, baseSize1;

            if (_workData.ScaleMode == GizmoDblAxisScaleMode.Independent)
            {
                dragAlongAxis0 = _planeDragSession.DragDelta.Dot(_workData.Axis0);
                dragAlongAxis1 = _planeDragSession.DragDelta.Dot(_workData.Axis1);

                snapStep0 = _workData.IndSnapStep0;
                snapStep1 = _workData.IndSnapStep1;
                baseSize0 = _workData.IndBaseSize0;
                baseSize1 = _workData.IndBaseSize1;
            }
            else
            {
                dragAlongAxis0 = _planeDragSession.DragDelta.Dot(_workData.PropAxis);
                dragAlongAxis1 = dragAlongAxis0;

                snapStep0 = snapStep1 = _workData.PropSnapStep;
                baseSize0 = baseSize1 = _workData.PropBaseSize;
            }

            if (CanSnap())
            {
                _relativeDragScale = Vector3.one;

                _accumSnapDrag0 += dragAlongAxis0;
                if (SnapMath.CanExtractSnap(snapStep0, _accumSnapDrag0))
                {
                    float oldScaledSize = _scaledSize0;
                    _scaledSize0 += SnapMath.ExtractSnap(snapStep0, ref _accumSnapDrag0);
                    _totalScale0 = _scaledSize0 / baseSize0;
                    _relativeScale0 = _scaledSize0 / oldScaledSize;
                    _relativeDragScale[_workData.AxisIndex0] = _relativeScale0;
                }

                _accumSnapDrag1 += dragAlongAxis1;
                if (SnapMath.CanExtractSnap(snapStep1, _accumSnapDrag1))
                {
                    float oldScaledSize = _scaledSize1;
                    _scaledSize1 += SnapMath.ExtractSnap(snapStep1, ref _accumSnapDrag1);
                    _totalScale1 = _scaledSize1 / baseSize1;
                    _relativeScale1 = _scaledSize1 / oldScaledSize;
                    _relativeDragScale[_workData.AxisIndex1] = _relativeScale1;
                }
            }
            else
            {
                _accumSnapDrag0 = 0.0f;
                _accumSnapDrag1 = 0.0f;

                float oldScaledSize = _scaledSize0;
                _scaledSize0 += dragAlongAxis0 * Sensitivity;
                _totalScale0 = _scaledSize0 / baseSize0;
                _relativeScale0 = _scaledSize0 / oldScaledSize;
                _relativeDragScale[_workData.AxisIndex0] = _relativeScale0;

                oldScaledSize = _scaledSize1;
                _scaledSize1 += dragAlongAxis1 * Sensitivity;
                _totalScale1 = _scaledSize1 / baseSize1;
                _relativeScale1 = _scaledSize1 / oldScaledSize;
                _relativeDragScale[_workData.AxisIndex1] = _relativeScale1;
            }

            _totalDragScale[_workData.AxisIndex0] = _totalScale0;
            _totalDragScale[_workData.AxisIndex1] = _totalScale1;
        }

        protected override void OnSessionEnd()
        {
            _accumSnapDrag0 = 0.0f;
            _accumSnapDrag1 = 0.0f;
            _relativeScale0 = 1.0f;
            _relativeScale1 = 1.0f;
            _totalScale0 = 1.0f;
            _totalScale1 = 1.0f;
        }
    }
}
