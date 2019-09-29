using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;
using CoordinateSharp;
using MainLogic;

public class Waypoint : MonoBehaviour
{
    public Transform tra;
    public Coordinate coordinate;

    private Vector3 lastPos;

    private void Start()
    {
        tra = gameObject.transform;
        var position = tra.position;
        coordinate = MainLoop.SceneToCoordinate(position);
        lastPos = position;
    }

    private void Update()
    {
        if (tra.position != lastPos)
        {
            print("waypoint update");
            var position = tra.position;
            
            
            lastPos = position;
            
            coordinate = MainLoop.SceneToCoordinate(position);
            
        }
    }
}
