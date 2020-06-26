using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;
using CoordinateSharp;

public class Waypoint : MonoBehaviour
{
    public Transform tra;
    public Coordinate coordinate;
    public Circle circle;
    public GameObject inspectorPanel;
    public Main mainLoop;
    private Vector3 lastPos;
    


    private void Start()
    {
        tra = gameObject.transform;
        var position = tra.position;
        coordinate = Main.SceneToCoordinate(position);
        lastPos = position;
    }

    private void Update()
    {
        if (tra.position != lastPos)
        {
            //print("waypoint update");
            var position = tra.position;
            
            
            lastPos = position;
            
            coordinate = Main.SceneToCoordinate(position);
            mainLoop.UpdateAccumalatedTimes();
        }

    }

    private void OnMouseOver()
    {
        circle.width = 0.1f;
        gameObject.GetComponent<Renderer>().material.color = Color.yellow;
    }

    private void OnMouseExit()
    {
        circle.width = 0.08f;
        gameObject.GetComponent<Renderer>().material.color = Color.black;
    }
}
