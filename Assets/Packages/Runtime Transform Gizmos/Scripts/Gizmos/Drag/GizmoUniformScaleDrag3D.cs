using System.Collections.Generic;
using UnityEngine;

namespace RTG
{
    public class GizmoUniformScaleDrag3D : GizmoPlaneDrag3D
    {
        public struct WorkData
        {
            public Vector3 CameraRight;
            public Vector3 CameraUp;
            public Vector3 DragOrigin;
            public float BaseSize;
            public float SnapStep;
        }

        private WorkData _workData;
        private Vector3 _planeAxis0;
        private Vector3 _planeAxis1;
        private float _scaledSize;
        private float _relativeScale = 1.0f;
        private float _totalScale = 1.0f;

        public override GizmoDragChannel DragChannel { get { return GizmoDragChannel.Scale; } }
        public float TotalScale { get { return _totalScale; } }
        public float RelativeScale { get { return _relativeScale; } }

        public void SetWorkData(WorkData workData)
        {
            if (!IsActive)
            {
                _workData = workData;
                _scaledSize = _workData.BaseSize;
            }
        }

        protected override Plane CalculateDragPlane()
        {
            _planeAxis0 = _workData.CameraRight;
            _planeAxis1 = _workData.CameraUp;

            return new Plane(Vector3.Cross(_planeAxis0, _planeAxis1).normalized, _workData.DragOrigin);
        }

        protected override void CalculateDragValues()
        {
            Vector3 planeDragPoint = _planeDragSession.DragPoint;
            Vector3 offsetFromScaleOrigin = (planeDragPoint - _workData.DragOrigin);

            float dragAlongAxis0 = offsetFromScaleOrigin.Dot(_planeAxis0);
            float dragAlongAxis1 = offsetFromScaleOrigin.Dot(_planeAxis1);

            if (CanSnap())
            {
                _relativeDragScale = Vector3.one;
                float accumDrag = (dragAlongAxis0 + dragAlongAxis1);
                if (SnapMath.CanExtractSnap(_workData.SnapStep, accumDrag))
                {
                    float oldScaledSize = _scaledSize;
                    _scaledSize = _workData.BaseSize + SnapMath.ExtractSnap(_workData.SnapStep, accumDrag);
                    _relativeScale = _scaledSize / oldScaledSize;
                    _totalScale = _scaledSize / _workData.BaseSize;
                    _relativeDragScale = Vector3Ex.FromValue(_relativeScale);
                }
            }
            else
            {
                float oldScaledSize = _scaledSize;
                _scaledSize = _workData.BaseSize + (dragAlongAxis0 + dragAlongAxis1) * Sensitivity;
                _relativeScale = _scaledSize / oldScaledSize;
                _totalScale = _scaledSize / _workData.BaseSize;
                _relativeDragScale = Vector3Ex.FromValue(_relativeScale);
            }

            _totalDragScale = Vector3Ex.FromValue(_totalScale);
        }

        protected override void OnSessionEnd()
        {
            _relativeScale = 1.0f;
            _totalScale = 1.0f;
        }
    }
}
