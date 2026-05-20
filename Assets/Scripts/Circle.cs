using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;


[ExecuteInEditMode]
public class Circle : MonoBehaviour
{

    public int segments = 360;
    public LineRenderer line;
    public float radius = 10f;
    public float width = 0.33f;

    private int curSegments;
    private float curRadius;
    private float curWidth;
    private bool dirty;
    
    private void Start()
    {
        //line.useWorldSpace = false;
        line.startWidth = width;
        line.endWidth = width;

        curRadius = radius;
        curSegments = segments;
        curWidth = width;
        dirty = true;

    }

    private void Update()
    {

        if (curRadius != radius) dirty = true;
        if (curSegments != segments) dirty = true;
        if (curWidth != width) dirty = true;
        
        if (!dirty) return;
        Refresh();
    }

    private void Refresh()
    {

        line.positionCount = segments + 1;
        line.startWidth = width;
        line.endWidth = width;

        var pointCount = segments + 1; // add extra point to make startpoint and endpoint the same to close the circle
        var points = new Vector3[pointCount];

        for (int i = 0; i < pointCount; i++)
        {
            var rad = Mathf.Deg2Rad * (i * 360f / segments);
            points[i] = new Vector3(Mathf.Sin(rad) * radius, 0, Mathf.Cos(rad) * radius);
        }

        line.SetPositions(points);

    }
}
